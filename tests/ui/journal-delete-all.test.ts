import { expect, test, type Page } from '@playwright/test';
import { navigateFromDrawer as navigate } from './fixtures/navigation';

// No hand-built cache: serialize the report's actual worker/WASM book before deletion.
const draft = `2026-10-02 ! "Deleted local draft"
  Expenses:Food
  Assets:Cash
`;
const files = {
	'cashier.bean': `${draft}2026-10-03 * "Deleted local amount"
  Expenses:Food 7 RUB
  Assets:Cash -7 RUB
`,
	'main.bean': `option "operating_currency" "USD"
option "operating_currency" "RUB"
2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2000-01-01 open Income:Salary
include "included.bean"
2026-10-01 * "Server USD expense"
  Expenses:Food 20 USD
  Assets:Cash -20 USD
2026-10-01 * "Server USD income"
  Income:Salary -100 USD
  Assets:Cash 100 USD
`,
	'included.bean': `2026-10-01 price RUB 2 USD
2026-10-01 * "Server RUB expense"
  Expenses:Food 30 RUB
  Assets:Cash -30 RUB
2026-10-01 * "Server RUB income"
  Income:Salary -40 RUB
  Assets:Cash 40 RUB
`,
	'unrelated.txt': 'Keep unrelated source unchanged'
};

async function storedState(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const sources: Record<string, string> = {};
		for await (const [name, handle] of root.entries()) {
			if (handle.kind === 'file' && !name.startsWith('ledger-cache.bin'))
				sources[name] = await (await (handle as FileSystemFileHandle).getFile()).text();
		}
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const settings = await new Promise<unknown[]>((resolve, reject) => {
				const request = db.transaction('settings').objectStore('settings').getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return { sources, settings };
		} finally {
			db.close();
		}
	});
}

async function report(page: Page) {
	await navigate(page, 'Reports');
	await page.getByRole('link', { name: 'Income vs Expenses', exact: true }).click();
	await expect(page).toHaveURL(/\/reports\/income-expense$/);
	await expect(page.getByRole('combobox')).toBeVisible();
}
async function expectReport(page: Page, remainingError: boolean) {
	if (remainingError) {
		const status = page.getByRole('status');
		await expect(status).toContainText('Report incomplete');
		await status.locator('summary').click();
		await expect(status).toContainText('Genuine server error');
		await expect(status).not.toContainText('Deleted local draft');
		await expect(page.locator('canvas')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Income \(|^Expenses \(/ })).toHaveCount(0);
	} else {
		await expect(page.locator('canvas')).toBeVisible();
		await expect(page.getByRole('status')).toHaveCount(0);
		await expect(page.getByRole('button', { name: /^Income \(/ })).toContainText('180.00 USD');
		await expect(page.getByRole('button', { name: /^Expenses \(/ })).toContainText('80.00 USD');
	}
}
async function expectServerPostings(page: Page, remainingError: boolean) {
	await navigate(page, 'Reports');
	await page.getByRole('link', { name: 'Queries', exact: true }).click();
	await page
		.locator('textarea')
		.fill(
			'SELECT number, currency, description WHERE account ~ "^(Expenses|Income)" ORDER BY description'
		);
	await page.getByRole('button', { name: 'Query', exact: true }).click();
	const rows = page.locator('tbody tr');
	await expect(rows).toHaveCount(remainingError ? 5 : 4);
	for (const [description, number, currency] of [
		['Server USD expense', '20', 'USD'],
		['Server USD income', '-100', 'USD'],
		['Server RUB expense', '30', 'RUB'],
		['Server RUB income', '-40', 'RUB']
	]) {
		const row = rows.filter({ hasText: description });
		await expect(row.locator('td').nth(0)).toHaveText(number);
		await expect(row.locator('td').nth(1)).toHaveText(currency);
	}
	await expect(rows.filter({ hasText: 'Deleted local' })).toHaveCount(0);
	if (remainingError) await expect(rows.filter({ hasText: 'Genuine server error' })).toHaveCount(1);
}

for (const caching of [true, false]) {
	for (const remainingError of [false, true]) {
		test(`Delete All refreshes warm and reloaded reports; cache=${caching}, remaining error=${remainingError}`, async ({
			page,
			context
		}) => {
			await page.setViewportSize({ width: 1280, height: 1000 });
			await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));
			const apiRequests: string[] = [];
			const pageErrors: string[] = [];
			context.on('request', (request) => {
				if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
			});
			page.on('pageerror', (error) => pageErrors.push(error.message));
			await page.goto('/');
			await expect(page.getByText('The device journal is empty')).toBeVisible();
			await page.evaluate(
				async ({ sources, caching }) => {
					const root = await navigator.storage.getDirectory();
					for (const [name, source] of Object.entries(sources)) {
						const writer = await (
							await root.getFileHandle(name, { create: true })
						).createWritable();
						await writer.write(source);
						await writer.close();
					}
					const db = await new Promise<IDBDatabase>((resolve, reject) => {
						const request = indexedDB.open('Cashier');
						request.onsuccess = () => resolve(request.result);
						request.onerror = () => reject(request.error);
					});
					try {
						await new Promise<void>((resolve, reject) => {
							const tx = db.transaction('settings', 'readwrite');
							for (const [key, value] of Object.entries({
								userBookFilename: 'main.bean',
								ledgerCacheEnabled: caching,
								currency: 'USD',
								syncApiToken: 'delete-all-preserved-token',
								syncServerUrl: 'https://delete-all.invalid'
							}))
								tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
							tx.oncomplete = () => resolve();
							tx.onerror = () => reject(tx.error);
							tx.onabort = () => reject(tx.error);
						});
					} finally {
						db.close();
					}
				},
				{
					sources: {
						...files,
						'included.bean':
							files['included.bean'] +
							(remainingError ? draft.replace('Deleted local draft', 'Genuine server error') : '')
					},
					caching
				}
			);
			await page.goto('/reports/income-expense');
			const status = page.getByRole('status');
			await expect(status).toContainText('Report incomplete');
			await status.locator('summary').click();
			await expect(status).toContainText('Deleted local draft');
			const warmWorker = page.workers().find((worker) => worker.url().includes('ledger.worker'));
			expect(warmWorker).toBeDefined();
			if (caching) {
				await warmWorker!.evaluate(async () => {
					// Exercise the worker's real serialization/cache-metadata path as fixture setup.
					// Negative request IDs cannot collide with the application's client requests.
					const scope = globalThis as unknown as {
						postMessage: (message: { id: number; type: string; message?: string }) => void;
					};
					await new Promise<void>((resolve, reject) => {
						const original = scope.postMessage;
						scope.postMessage = (message) => {
							original.call(globalThis, message);
							if (message.id !== -1) return;
							scope.postMessage = original;
							if (message.type === 'serialize-ledger-done') resolve();
							else reject(new Error(message.message ?? message.type));
						};
						globalThis.dispatchEvent(
							new MessageEvent('message', {
								data: { id: -1, type: 'serialize-ledger' }
							})
						);
					});
				});
				const metadataSize = await page.evaluate(async () => {
					const root = await navigator.storage.getDirectory();
					return (await (await root.getFileHandle('ledger-cache.bin.json')).getFile()).size;
				});
				expect(metadataSize).toBeGreaterThan(0);
			}
			const before = await storedState(page);
			await navigate(page, 'Journal');
			await page.locator('.navbar .dropdown > button').click();
			await page.getByText('Delete All', { exact: true }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click();
			await expect(page.getByText('The device journal is empty')).toBeVisible();
			await expect(
				page.getByText('All local transactions deleted.', { exact: true })
			).toBeVisible();
			// Client-side navigation is essential: a full document load masked this regression.
			await report(page);
			expect(page.workers()).toContain(warmWorker);
			await expectReport(page, remainingError);
			await expectServerPostings(page, remainingError);
			await report(page);
			await page.reload();
			await expectReport(page, remainingError);
			await expectServerPostings(page, remainingError);
			expect(await storedState(page)).toEqual({
				...before,
				sources: { ...before.sources, 'cashier.bean': '' }
			});
			expect(apiRequests).toEqual([]);
			expect(pageErrors).toEqual([]);
		});
	}
}
