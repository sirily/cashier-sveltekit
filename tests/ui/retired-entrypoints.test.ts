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
