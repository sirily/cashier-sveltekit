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

test('drawer omits Voice Entry while keeping Journal reachable', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.locator('main .navbar button').first().click();
	await expect(page.locator('#drawer-modal')).toBeChecked();
	const drawer = page.locator('.drawer-side');
	await expect(drawer.getByRole('link', { name: 'Journal', exact: true })).toBeVisible();
	await expect(drawer.getByRole('link', { name: /voice entry/i })).toHaveCount(0);
	await expect(page.locator('a[href^="/tools/voice-entry"]')).toHaveCount(0);
	await drawer.getByRole('link', { name: 'Journal', exact: true }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.locator('#drawer-modal')).not.toBeChecked();
});
