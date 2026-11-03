import { expect, test, type Page } from '@playwright/test';

const book = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash USD
2000-01-01 open Expenses:Food USD
2025-01-01 * "Server cafe" "Downloaded book stays intact"
  cashier_id: "retired-entrypoint-server-id"
  Expenses:Food  5.00 USD
  Assets:Cash  -5.00 USD
`;
const journal = `include "server.bean"
2025-01-02 ! "Local cafe" "Pending journal stays intact"
  cashier_id: "retired-entrypoint-local-id"
  Expenses:Food  12.50 USD
  Assets:Cash  -12.50 USD
`;

async function seedStoredData(page: Page) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ book, journal }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(['settings', 'scheduled', 'accounts', 'payees'], 'readwrite');
					const settings = {
						ledgerDataSource: 'beancount',
						userBookFilename: 'server.bean',
						ledgerCacheEnabled: false,
						currency: 'USD',
						syncServerUrl: 'https://cashier.test/api',
						syncServers: [
							{
								id: 'retained-server',
								name: 'Retained server',
								url: 'https://cashier.test/api'
							}
						],
						syncActiveServerId: 'retained-server',
						syncApiToken: 'retired-entrypoint-test-only-secret'
					};
					for (const [key, value] of Object.entries(settings)) {
						tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
					}
					tx.objectStore('accounts').put({ name: 'Assets:Cash' });
					tx.objectStore('payees').put({ name: 'Local cafe' });
					tx.objectStore('scheduled').put({
						id: 41,
						nextDate: '2099-01-15',
						period: '1 month',
						count: 3,
						endDate: null,
						remarks: 'Schedule stays intact',
						transaction: {
							date: '2099-01-15',
							flag: '*',
							payee: 'Scheduled cafe',
							note: 'Scheduled food',
							postings: [
								{ account: 'Expenses:Food', amount: 15, currency: 'USD' },
								{ account: 'Assets:Cash', amount: -15, currency: 'USD' }
							]
						}
					});
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.onabort = () => reject(tx.error);
				});
			} finally {
				db.close();
			}

			const root = await navigator.storage.getDirectory();
			for (const [name, content] of Object.entries({
				'cashier.bean': journal,
				'server.bean': book
			})) {
				const handle = await root.getFileHandle(name, { create: true });
				const writer = await handle.createWritable();
				await writer.write(content);
				await writer.close();
			}
		},
		{ book, journal }
	);
	await page.goto('/journal');
	await expect(page.getByRole('main')).toContainText('Pending journal stays intact');
}

async function readStoredData(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const records: Record<string, unknown[]> = {};
		try {
			await new Promise<void>((resolve, reject) => {
				const names = Array.from(db.objectStoreNames);
				const tx = db.transaction(names, 'readonly');
				for (const name of names) {
					const request = tx.objectStore(name).getAll();
					request.onsuccess = () => {
						records[name] = request.result;
					};
				}
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			});
		} finally {
			db.close();
		}

		const files: Record<string, number[]> = {};
		async function readDirectory(directory: FileSystemDirectoryHandle, prefix = '') {
			for await (const [name, handle] of directory.entries()) {
				const path = `${prefix}${name}`;
				if (handle.kind === 'directory') {
					await readDirectory(handle as FileSystemDirectoryHandle, `${path}/`);
				} else {
					const file = await (handle as FileSystemFileHandle).getFile();
					files[path] = Array.from(new Uint8Array(await file.arrayBuffer()));
				}
			}
		}
		await readDirectory(await navigator.storage.getDirectory());
		return { records, files };
	});
}

async function watchMicrophoneInitialization(page: Page) {
	// Keep observations outside the document so a reload cannot erase an attempted initialization.
	const calls: string[] = [];
	await page.exposeFunction('recordMicrophoneAttempt', (api: string) => calls.push(api));
	await page.addInitScript(() => {
		const record = (api: string) => {
			void (
				window as unknown as { recordMicrophoneAttempt: (api: string) => Promise<void> }
			).recordMicrophoneAttempt(api);
		};
		for (const api of ['SpeechRecognition', 'webkitSpeechRecognition']) {
			Object.defineProperty(window, api, {
				configurable: true,
				value: class {
					constructor() {
						record(api);
					}
					start() {
						record(`${api}.start`);
					}
				}
			});
		}
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			configurable: true,
			value: () => {
				record('getUserMedia');
				return Promise.reject(new Error('Microphone access is forbidden in retirement tests'));
			}
		});
		for (const api of ['getUserMedia', 'webkitGetUserMedia']) {
			Object.defineProperty(navigator, api, {
				configurable: true,
				value: () => record(api)
			});
		}
	});
	return calls;
}

for (const path of ['/tools/voice-entry', '/tools/voice-entry/']) {
	test(`retired voice URL ${path} cannot initialize a microphone or mutate stored data`, async ({
		page
	}) => {
		const microphoneCalls = await watchMicrophoneInitialization(page);
		await seedStoredData(page);
		const before = await readStoredData(page);
		expect(before.files['cashier.bean']).toEqual(Array.from(Buffer.from(journal)));
		expect(before.files['server.bean']).toEqual(Array.from(Buffer.from(book)));

		await page.goto(path);
		await expect(page).toHaveURL(/\/tools\/voice-entry\/?$/);
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);

		await page.reload();
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);
		expect(microphoneCalls).toEqual([]);
	});
}

async function watchPeerInitialization(page: Page) {
	// Keep observations across navigation/reload without opening a real peer connection.
	const calls: string[] = [];
	await page.exposeFunction('recordPeerAttempt', (api: string) => calls.push(api));
	await page.addInitScript(() => {
		for (const api of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
			Object.defineProperty(window, api, {
				configurable: true,
				value: class {
					constructor() {
						void (
							window as unknown as { recordPeerAttempt: (api: string) => Promise<void> }
						).recordPeerAttempt(api);
						throw new Error('Peer connections are forbidden in retirement tests');
					}
				}
			});
		}
	});
	return calls;
}

for (const path of ['/demo/peer-sync', '/demo/peer-sync/']) {
	test(`retired peer URL ${path} cannot initialize WebRTC or media or mutate stored data`, async ({
		page
	}) => {
		const peerCalls = await watchPeerInitialization(page);
		const mediaCalls = await watchMicrophoneInitialization(page);
		await seedStoredData(page);
		const before = await readStoredData(page);
		expect(before.files['cashier.bean']).toEqual(Array.from(Buffer.from(journal)));
		expect(before.files['server.bean']).toEqual(Array.from(Buffer.from(book)));

		await page.goto(path);
		await expect(page).toHaveURL(/\/demo\/peer-sync\/?$/);
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);

		await page.reload();
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);
		expect(peerCalls).toEqual([]);
		expect(mediaCalls).toEqual([]);
	});
}

test('drawer omits Voice Entry and Peer Sync while keeping Journal reachable', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.locator('main .navbar button').first().click();
	await expect(page.locator('#drawer-modal')).toBeChecked();
	const drawer = page.locator('.drawer-side');
	await expect(drawer.getByRole('link', { name: 'Journal', exact: true })).toBeVisible();
	await expect(drawer.getByRole('link', { name: /voice entry/i })).toHaveCount(0);
	await expect(page.locator('a[href^="/tools/voice-entry"]')).toHaveCount(0);
	await expect(drawer.getByRole('link', { name: /peer sync/i })).toHaveCount(0);
	await expect(page.locator('a[href^="/demo/peer-sync"]')).toHaveCount(0);
	await drawer.getByRole('link', { name: 'Journal', exact: true }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.locator('#drawer-modal')).not.toBeChecked();
});

const retiredRemotePaths = [
	'/settings/webdav-cfg',
	'/backup/webdav',
	'/backup/webdav/preview?source=remote&filename=settings.json',
	'/backup/webdav/diff?filename=settings.json',
	'/cloud-backup'
];

for (const path of retiredRemotePaths.flatMap((path) => {
	const [pathname, query] = path.split('?');
	return [path, `${pathname}/${query ? `?${query}` : ''}`];
})) {
	test(`retired remote backup URL ${path} cannot contact a server or mutate stored data`, async ({
		page
	}) => {
		await seedStoredData(page);
		const before = await readStoredData(page);
		const remoteRequests: string[] = [];
		const origin = new URL(page.url()).origin;
		page.on('request', (request) => {
			if (
				new URL(request.url()).origin !== origin ||
				['PROPFIND', 'MKCOL', 'PUT', 'DELETE'].includes(request.method())
			) {
				remoteRequests.push(`${request.method()} ${request.url()}`);
			}
		});
		await page.route(/^https?:\/\/(?!localhost(?::|\/)|127\.0\.0\.1(?::|\/))/, (route) =>
			route.abort()
		);

		await page.goto(path);
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);
		await page.reload();
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);
		expect(remoteRequests).toEqual([]);
	});
}

test('legacy remote credential cleanup preserves all other IndexedDB and OPFS data without a request', async ({
	page
}) => {
	await seedStoredData(page);
	await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('settings', 'readwrite');
				for (const [key, value] of Object.entries({
					'webdav-settings': {
						url: 'https://retired-backup.invalid/dav',
						username: 'old-user',
						password: 'old-password'
					},
					pCloudToken: 'old-cloud-token',
					backupServerUrl: 'https://retired-backup.invalid/cloud'
				}))
					tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	});
	const before = await readStoredData(page);
	const remoteRequests: string[] = [];
	await page.route('https://retired-backup.invalid/**', (route) => {
		remoteRequests.push(route.request().url());
		return route.abort();
	});
	await page.reload();
	await expect(page.getByRole('main')).toContainText('Pending journal stays intact');
	const expected = structuredClone(before);
	expected.records.settings = expected.records.settings.filter(
		(row) =>
			!['webdav-settings', 'pCloudToken', 'backupServerUrl'].includes((row as { key: string }).key)
	);
	expect(await readStoredData(page)).toEqual(expected);
	await page.reload();
	await expect(page.getByRole('main')).toContainText('Pending journal stays intact');
	expect(await readStoredData(page)).toEqual(expected);
	expect(remoteRequests).toEqual([]);
});

test('remote backup links are absent while local Backup and export remain reachable', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.locator('main .navbar button').first().click();
	const drawer = page.locator('.drawer-side');
	const tools = drawer.locator('details').filter({ has: page.locator('a[href="/backup"]') });
	await tools.locator('summary').click();
	await expect(drawer.getByRole('link', { name: 'Backup', exact: true })).toBeVisible();
	await expect(page.locator('a[href*="webdav"], a[href^="/cloud-backup"]')).toHaveCount(0);
	await drawer.getByRole('link', { name: 'Backup', exact: true }).click();
	await expect(page).toHaveURL(/\/backup$/);
	await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeVisible();
	await page.goto('/settings');
	await expect(page.locator('a[href*="webdav"], a[href^="/cloud-backup"]')).toHaveCount(0);
	for (const type of ['journal', 'scheduled']) {
		await page.goto(`/export/${type}`);
		await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
	}
});

const retiredLocalPaths = [
	'/opfs/import-ledger',
	'/import-ledger-xact',
	'/restore/scheduled',
	'/restore/settings',
	'/restore/arbitrary-item',
	'/settings/json-editor',
	'/opfs/sync',
	'/settings/filesystem'
];

async function watchRetiredIngress(page: Page) {
	const permissions: string[] = [];
	const requests: string[] = [];
	await page.exposeFunction('recordIngressPermission', (api: string) => permissions.push(api));
	await page.addInitScript(() => {
		const denied = (api: string) => () => {
			void (
				window as unknown as { recordIngressPermission: (api: string) => Promise<void> }
			).recordIngressPermission(api);
			return Promise.reject(new Error(`Retired ingress must not call ${api}`));
		};
		for (const api of ['showDirectoryPicker', 'showOpenFilePicker', 'showSaveFilePicker']) {
			Object.defineProperty(window, api, { configurable: true, value: denied(api) });
		}
		for (const method of ['queryPermission', 'requestPermission']) {
			Object.defineProperty(FileSystemHandle.prototype, method, {
				configurable: true,
				value: denied(`FileSystemHandle.${method}`)
			});
		}
	});
	const origin = new URL(page.url()).origin;
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (url.origin !== origin || url.pathname.startsWith('/api/') || request.method() !== 'GET') {
			requests.push(`${request.method()} ${request.url()}`);
		}
	});
	await page.route('**/*', (route) => {
		const url = new URL(route.request().url());
		if (url.origin !== origin || url.pathname.startsWith('/api/')) return route.abort();
		return route.continue();
	});
	return { permissions, requests };
}

async function attemptRetiredInputs(page: Page) {
	await expect(page.locator('input[type="file"], input[webkitdirectory]')).toHaveCount(0);
	await page.evaluate(() => {
		const target =
			document.querySelector('article section') ??
			document.querySelector('article') ??
			document.querySelector('main') ??
			document.body;
		const payloads = [
			{ name: 'cashier.bean', content: 'Retired upload must not overwrite the journal' },
			{ name: 'server.bean', content: 'Retired upload must not overwrite the book' },
			{ name: 'retired-new.bean', content: 'Retired upload must not create a file' },
			{
				name: 'backup.json',
				content: JSON.stringify({
					settings: [{ key: 'syncApiToken', value: '"foreign-token"' }],
					scx: [{ id: 41, remarks: 'Foreign schedule' }]
				})
			}
		];
		for (const { name, content } of payloads) {
			const transfer = new DataTransfer();
			transfer.items.add(new File([content], name));
			for (const type of ['dragenter', 'dragover', 'drop']) {
				target.dispatchEvent(
					new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer })
				);
			}
			// Recreating a stale input node must not revive a retired/delegated upload handler.
			const input = document.createElement('input');
			input.type = 'file';
			input.id = 'backupFile';
			input.name = 'files';
			input.setAttribute('webkitdirectory', '');
			input.files = transfer.files;
			target.appendChild(input);
			input.dispatchEvent(new Event('change', { bubbles: true }));
			input.remove();
			transfer.setData('text/plain', content);
			target.dispatchEvent(
				new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
			);
			target.dispatchEvent(
				new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: content })
			);
		}
		return new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		);
	});
	await expect(
		page.getByRole('heading', { name: /Confirm Restore|File Already Exists/ })
	).toHaveCount(0);
}

for (const path of retiredLocalPaths.flatMap((path) => [path, `${path}/`])) {
	test(`retired local ingress URL ${path} and stale inputs leave data intact without permissions or requests`, async ({
		page
	}) => {
		await seedStoredData(page);
		const observations = await watchRetiredIngress(page);
		const writes: string[] = [];
		await page.exposeFunction('recordRetiredWrite', (operation: string) => writes.push(operation));
		await page.addInitScript(() => {
			const record = (operation: string) => {
				void (
					window as unknown as { recordRetiredWrite: (operation: string) => Promise<void> }
				).recordRetiredWrite(operation);
			};
			for (const method of ['put', 'add', 'delete', 'clear'] as const) {
				const original = IDBObjectStore.prototype[method];
				Object.defineProperty(IDBObjectStore.prototype, method, {
					configurable: true,
					value: function (this: IDBObjectStore, ...args: unknown[]) {
						// Settings reads may delete absent retired remote credentials; those are not data writes.
						const absentRetiredKey =
							this.name === 'settings' &&
							method === 'delete' &&
							['webdav-settings', 'pCloudToken', 'backupServerUrl'].includes(String(args[0]));
						if (!absentRetiredKey) record(`IndexedDB.${this.name}.${method}`);
						return Reflect.apply(original, this, args);
					}
				});
			}
			const original = FileSystemFileHandle.prototype.createWritable;
			FileSystemFileHandle.prototype.createWritable = function (...args) {
				record(`OPFS.${this.name}.createWritable`);
				return original.apply(this, args);
			};
		});
		const before = await readStoredData(page);
		await page.goto(path);
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		await expect(page.locator('textarea')).toHaveCount(0);
		await attemptRetiredInputs(page);
		expect(await readStoredData(page)).toEqual(before);
		await page.reload();
		await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);
		expect(observations).toEqual({ permissions: [], requests: [] });
		expect(writes).toEqual([]);
	});
}

for (const path of ['/opfs', '/backup']) {
	test(`${path} keeps retained controls but rejects stale upload, file-drop and paste inputs`, async ({
		page
	}) => {
		await seedStoredData(page);
		const observations = await watchRetiredIngress(page);
		const before = await readStoredData(page);
		await page.goto(path);
		if (path === '/opfs') {
			await expect(page.getByRole('cell', { name: 'cashier.bean', exact: true })).toBeVisible();
			await expect(page.getByRole('cell', { name: 'server.bean', exact: true })).toBeVisible();
		} else {
			await expect(page.getByRole('button', { name: 'Backup', exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
			await expect(page.getByRole('link', { name: 'server Sync', exact: true })).toHaveAttribute(
				'href',
				'/sync'
			);
		}
		await expect(
			page.getByRole('button', { name: /Upload File|Restore/, includeHidden: true })
		).toHaveCount(0);
		await expect(page.locator('textarea')).toHaveCount(0);
		await attemptRetiredInputs(page);
		expect(await readStoredData(page)).toEqual(before);
		await page.reload();
		await expect(
			page.getByText(path === '/opfs' ? 'OPFS Files' : 'Create Backup', { exact: true })
		).toBeVisible();
		expect(await readStoredData(page)).toEqual(before);
		expect(observations).toEqual({ permissions: [], requests: [] });
	});
}

test('import and restore links are absent while manual journal, schedule and settings controls remain', async ({
	page
}) => {
	await seedStoredData(page);
	const before = await readStoredData(page);
	for (const path of ['/journal', '/scheduled-xacts', '/settings']) {
		await page.goto(path);
		await expect(
			page.locator(
				'a[href*="import-ledger"], a[href^="/restore/"], a[href="/settings/json-editor"]'
			)
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: /Import Ledger|Restore|JSON Editor/, includeHidden: true })
		).toHaveCount(0);
		if (path === '/settings') {
			await expect(page.locator('#currency')).toHaveValue('USD');
			await expect(page.getByRole('button', { name: 'Select', exact: true })).toHaveCount(2);
			await expect(page.getByRole('link', { name: 'server Sync', exact: true })).toHaveAttribute(
				'href',
				'/sync'
			);
		} else {
			await expect(page.locator('button.fixed')).toBeVisible();
		}
	}
	expect(await readStoredData(page)).toEqual(before);
});

for (const { name, selectIndex, settingKey, selectedFile } of [
	{ name: 'book', selectIndex: 0, settingKey: 'userBookFilename', selectedFile: 'alternate.bean' },
	{
		name: 'asset allocation TOML',
		selectIndex: 1,
		settingKey: 'aa.definition',
		selectedFile: 'allocation.toml'
	}
]) {
	test(`Settings ${name} picker keeps its URL and pending values until explicit save/reload`, async ({
		page
	}) => {
		await seedStoredData(page);
		await page.evaluate(
			async ({ book }) => {
				const db = await new Promise<IDBDatabase>((resolve, reject) => {
					const request = indexedDB.open('Cashier');
					request.onsuccess = () => resolve(request.result);
					request.onerror = () => reject(request.error);
				});
				try {
					await new Promise<void>((resolve, reject) => {
						const tx = db.transaction('settings', 'readwrite');
						for (const [key, value] of Object.entries({
							'aa.definition': 'original.toml',
							'aa.rootAccount': 'Assets:Investments',
							rememberLastTransaction: false,
							dateFormat: 'D MMM YYYY'
						})) {
							tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
						}
						tx.oncomplete = () => resolve();
						tx.onerror = () => reject(tx.error);
						tx.onabort = () => reject(tx.error);
					});
				} finally {
					db.close();
				}
				const root = await navigator.storage.getDirectory();
				for (const [filename, content] of Object.entries({
					'alternate.bean': book,
					'original.toml': '[allocation]\nname = "Original"\n',
					'allocation.toml': '[allocation]\nname = "Selected"\n'
				})) {
					const handle = await root.getFileHandle(filename, { create: true });
					const writer = await handle.createWritable();
					await writer.write(content);
					await writer.close();
				}
			},
			{ book }
		);
		const observations = await watchRetiredIngress(page);
		await page.goto('/settings');
		await expect(page.locator('#currency')).toHaveValue('USD');
		await expect(page.locator('#investment-account-root')).toHaveValue('Assets:Investments');
		await expect(page.locator('#date-format')).toHaveValue('D MMM YYYY');
		await expect(page.locator('#remember-last-transaction')).not.toBeChecked();
		const before = await readStoredData(page);
		await page.locator('#currency').fill('EUR');
		await page.locator('#investment-account-root').fill('Assets:Investments:Pending');
		await page.locator('#date-format').selectOption('YYYY-MM-DD');
		await page.locator('#remember-last-transaction').check();

		await page.getByRole('button', { name: 'Select', exact: true }).nth(selectIndex).click();
		await expect(page).toHaveURL(
			new URL(`/opfs/file-picker?returnSetting=${settingKey}`, page.url()).href
		);
		await page.getByRole('cell', { name: selectedFile, exact: true }).click();
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(new URL('/settings', page.url()).href);
		await expect(page.getByText(selectedFile, { exact: true })).toBeVisible();
		await expect(
			page.getByText(selectIndex === 0 ? 'original.toml' : 'server.bean', { exact: true })
		).toBeVisible();
		await expect(page.locator('#currency')).toHaveValue('EUR');
		await expect(page.locator('#investment-account-root')).toHaveValue(
			'Assets:Investments:Pending'
		);
		await expect(page.locator('#date-format')).toHaveValue('YYYY-MM-DD');
		await expect(page.locator('#remember-last-transaction')).toBeChecked();
		expect(await readStoredData(page)).toEqual(before);

		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(new URL('/', page.url()).href);
		const expected = structuredClone(before);
		const savedFields: Record<string, string | boolean> = {
			currency: 'EUR',
			'aa.rootAccount': 'Assets:Investments:Pending',
			rememberLastTransaction: true,
			dateFormat: 'YYYY-MM-DD',
			[settingKey]: selectedFile
		};
		expected.records.settings = expected.records.settings.map((row) => {
			const setting = row as { key: string; value: string };
			return Object.hasOwn(savedFields, setting.key)
				? { ...setting, value: JSON.stringify(savedFields[setting.key]) }
				: row;
		});
		expect(await readStoredData(page)).toEqual(expected);

		await page.goto('/settings');
		await page.reload();
		await expect(page).toHaveURL(new URL('/settings', page.url()).href);
		await expect(page.getByText(selectedFile, { exact: true })).toBeVisible();
		await expect(
			page.getByText(selectIndex === 0 ? 'original.toml' : 'server.bean', { exact: true })
		).toBeVisible();
		await expect(page.locator('#currency')).toHaveValue('EUR');
		await expect(page.locator('#investment-account-root')).toHaveValue(
			'Assets:Investments:Pending'
		);
		await expect(page.locator('#date-format')).toHaveValue('YYYY-MM-DD');
		await expect(page.locator('#remember-last-transaction')).toBeChecked();
		await expect(page.locator('#ledger-cache-enabled')).not.toBeChecked();
		expect(await readStoredData(page)).toEqual(expected);
		expect(observations).toEqual({ permissions: [], requests: [] });
	});
}

test('OPFS browsing, settings file selection and existing source editing remain local', async ({
	page
}) => {
	await seedStoredData(page);
	const observations = await watchRetiredIngress(page);
	const before = await readStoredData(page);
	await page.goto('/settings');
	await expect(page.getByText('Book file:', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Select', exact: true }).first().click();
	await expect(page).toHaveURL(/\/opfs\/file-picker\?/);
	await page.getByRole('cell', { name: 'server.bean', exact: true }).click();
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByText('server.bean', { exact: true })).toBeVisible();
	expect(await readStoredData(page)).toEqual(before);

	await page.goto('/opfs');
	await page.getByRole('cell', { name: 'server.bean', exact: true }).click();
	await expect(page).toHaveURL(/\/opfs\/edit-file\?file=server.bean$/);
	await expect(page.locator('textarea')).toHaveValue(book);
	const edited = `${book}; Local source edit\n`;
	await page.locator('textarea').fill(edited);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	const expected = structuredClone(before);
	expected.files['server.bean'] = Array.from(Buffer.from(edited));
	expect(await readStoredData(page)).toEqual(expected);
	await page.reload();
	await expect(page.locator('textarea')).toHaveValue(edited);
	expect(await readStoredData(page)).toEqual(expected);
	expect(observations).toEqual({ permissions: [], requests: [] });
});

async function updateSyncSettings(
	page: Page,
	values: Record<string, unknown>,
	remove: string[] = []
) {
	await page.evaluate(
		async ({ values, remove }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction('settings', 'readwrite');
					const store = tx.objectStore('settings');
					for (const key of remove) store.delete(key);
					for (const [key, value] of Object.entries(values))
						store.put({ key, value: JSON.stringify(value) });
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				});
			} finally {
				db.close();
			}
		},
		{ values, remove }
	);
}

for (const source of ['filesystem', 'ledger', 'beancount']) {
	for (const syncLedgerFiles of [false, true]) {
		test(`server Sync loads ${source} configuration (book sync ${syncLedgerFiles}) without requests, permissions or data changes`, async ({
			page
		}) => {
			await seedStoredData(page);
			await updateSyncSettings(page, {
				ledgerDataSource: source,
				syncBeancountRootFile: 'books/personal.bean',
				syncAccounts: true,
				syncPayees: false,
				syncLedgerFiles,
				syncOpeningBalances: true,
				syncAaValues: true,
				syncAssetAllocation: true
			});
			const observations = await watchRetiredIngress(page);
			const before = await readStoredData(page);
			for (let visit = 0; visit < 2; visit++) {
				await page.goto('/sync');
				await expect(page.getByLabel('Cashier Server URL')).toHaveValue('https://cashier.test/api');
				await expect(page.getByLabel('API token')).toHaveValue(
					'retired-entrypoint-test-only-secret'
				);
				await expect(page.getByLabel('Remote root book file')).toHaveValue('books/personal.bean');
				await expect(page.getByLabel('Accounts', { exact: true })).toBeChecked();
				await expect(page.getByLabel('Payees', { exact: true })).not.toBeChecked();
				await expect(page.getByLabel('Send → pull → reconcile')).toBeChecked({
					checked: syncLedgerFiles
				});
				await expect(
					page.getByText('Send completed local transactions', { exact: true })
				).toHaveCount(syncLedgerFiles ? 1 : 0);
				await expect(page.locator('main select')).toHaveCount(0);
				await expect(page.getByLabel('Opening balances', { exact: true })).toHaveCount(0);
				expect(await readStoredData(page)).toEqual(before);
			}
			expect(observations).toEqual({ permissions: [], requests: [] });
		});
	}
}

for (const partial of [false, true]) {
	test(`${partial ? 'partial' : 'fresh'} Sync configuration offers Beancount directly without inventing credentials or automatically syncing`, async ({
		page
	}) => {
		await seedStoredData(page);
		await updateSyncSettings(
			page,
			{ syncAccounts: partial, syncLedgerFiles: false, syncPayees: false },
			[
				'ledgerDataSource',
				'syncServerUrl',
				'syncApiToken',
				'syncBeancountRootFile',
				...(partial ? [] : ['syncServers', 'syncActiveServerId'])
			]
		);
		const observations = await watchRetiredIngress(page);
		const before = await readStoredData(page);
		await page.goto('/sync');
		await expect(page.getByLabel('Cashier Server URL')).toHaveValue(
			partial ? 'https://cashier.test/api' : ''
		);
		await expect(page.getByLabel('API token')).toHaveValue('');
		await expect(page.getByLabel('Remote root book file')).toHaveValue('main.bean');
		await expect(page.getByLabel('Send → pull → reconcile')).not.toBeChecked();
		await expect(page.getByLabel('Accounts', { exact: true })).toBeChecked({ checked: partial });
		await expect(page.locator('main select')).toHaveCount(0);
		expect(await readStoredData(page)).toEqual(before);
		await page.reload();
		await expect(page.getByLabel('API token')).toHaveValue('');
		expect(await readStoredData(page)).toEqual(before);
		if (!partial) {
			await page.getByLabel('Accounts', { exact: true }).check();
			const beforeSync = await readStoredData(page);
			await page.getByRole('button', { name: 'Synchronize', exact: true }).click();
			await expect(page.locator('#toast-container')).toContainText(
				'Cashier Server URL is required'
			);
			expect(await readStoredData(page)).toEqual(beforeSync);
		}
		expect(observations).toEqual({ permissions: [], requests: [] });
	});
}

test('drawer and home card both open server Sync and expose no filesystem links', async ({
	page
}) => {
	await seedStoredData(page);
	await page.setViewportSize({ width: 390, height: 844 });
	const observations = await watchRetiredIngress(page);
	const before = await readStoredData(page);
	await page.goto('/');
	const cardLink = page.getByRole('main').getByRole('link', { name: 'Server Sync', exact: true });
	await expect(cardLink).toHaveAttribute('href', '/sync');
	await page.locator('main .navbar button').first().click();
	await expect(page.locator('#drawer-modal')).toBeChecked();
	const drawer = page.locator('.drawer-side');
	await drawer
		.locator('details')
		.filter({ has: page.getByText('Data', { exact: true }) })
		.evaluate((node) => node.setAttribute('open', ''));
	const drawerLink = drawer.getByRole('link', { name: 'Server Sync', exact: true });
	await expect(drawerLink).toHaveAttribute('href', '/sync');
	await expect(page.locator('a[href="/opfs/sync"], a[href="/settings/filesystem"]')).toHaveCount(0);
	await drawerLink.click();
	await expect(page).toHaveURL(/\/sync$/);
	await expect(page.getByLabel('Cashier Server URL')).toHaveValue('https://cashier.test/api');
	expect(await readStoredData(page)).toEqual(before);
	expect(observations).toEqual({ permissions: [], requests: [] });
});

test('Reload server data calls only the authenticated server reload, without pulling or changing local data', async ({
	page
}) => {
	await seedStoredData(page);
	await updateSyncSettings(page, {
		syncBeancountRootFile: 'main.bean',
		syncLedgerFiles: true,
		syncServerSelectionCleared: false
	});
	const observations = await watchRetiredIngress(page);
	const reloads: string[] = [];
	await page.route('https://cashier.test/api/reload', async (route) => {
		expect(route.request().method()).toBe('GET');
		expect(route.request().headers().authorization).toBe(
			'Bearer retired-entrypoint-test-only-secret'
		);
		reloads.push(route.request().url());
		await route.fulfill({ status: 200, body: 'reloaded' });
	});
	await page.goto('/sync');
	await expect(page.getByLabel('Cashier Server URL')).toHaveValue('https://cashier.test/api');
	const before = await readStoredData(page);
	await page.getByRole('button', { name: 'Reload server data', exact: true }).click();
	await expect(page.locator('#toast-container')).toContainText(
		'Server data reloaded. Synchronize to download'
	);
	expect(reloads).toEqual(['https://cashier.test/api/reload']);
	expect(await readStoredData(page)).toEqual(before);
	expect(observations).toEqual({
		permissions: [],
		requests: ['GET https://cashier.test/api/reload']
	});
});

test('metadata-only server Sync refreshes selected references without sending, pulling or reconciling the journal', async ({
	page
}) => {
	await seedStoredData(page);
	await updateSyncSettings(page, {
		ledgerDataSource: 'filesystem',
		syncBeancountRootFile: 'main.bean',
		syncServerSelectionCleared: false,
		syncAccounts: true,
		syncPayees: false,
		syncLedgerFiles: false,
		syncOpeningBalances: true,
		syncAaValues: true,
		syncAssetAllocation: true
	});
	const observations = await watchRetiredIngress(page);
	const queries: string[] = [];
	await page.route('https://cashier.test/api?**', async (route) => {
		const request = route.request();
		const query = new URL(request.url()).searchParams.get('query');
		expect(request.method()).toBe('GET');
		expect(request.headers().authorization).toBe('Bearer retired-entrypoint-test-only-secret');
		expect(query).toBe('SELECT sum(number), currency, account ORDER BY account');
		queries.push(request.url());
		await route.fulfill({ json: { rows: [['0', 'USD', 'Assets:Cash']] } });
	});
	await page.goto('/sync');
	await expect(page.getByLabel('Accounts', { exact: true })).toBeChecked();
	await expect(page.getByLabel('Send → pull → reconcile')).not.toBeChecked();
	await expect(page.getByText('Send completed local transactions', { exact: true })).toHaveCount(0);
	const before = await readStoredData(page);
	await page.getByRole('button', { name: 'Synchronize', exact: true }).click();
	await expect(page.locator('#toast-container')).toContainText(
		'Metadata synchronization completed successfully'
	);
	await expect(page.getByText('metadata-only', { exact: true })).toBeVisible();
	expect(queries).toHaveLength(1);
	const after = await readStoredData(page);
	expect(after.files).toEqual(before.files);
	for (const name of Object.keys(before.records).filter((name) => name !== 'accounts')) {
		expect(after.records[name]).toEqual(before.records[name]);
	}
	expect(observations).toEqual({ permissions: [], requests: [`GET ${queries[0]}`] });
});
