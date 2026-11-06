import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import init, { Ledger } from '@rustledger/wasm';

let cache: number[];
test.beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
	const ledger = Ledger.fromFiles(
		{ 'cashier.bean': `include "selected.bean"\n${local}`, 'selected.bean': selected },
		'cashier.bean'
	);
	cache = Array.from(ledger.serialize());
	ledger.free();
});

const selected = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash USD
2000-01-01 open Assets:Bank RUB
2000-01-01 open Equity:Opening-Balances
2000-01-01 open Expenses:Food
2026-10-01 * "Selected book cash"
  Assets:Cash 1460 USD
  Equity:Opening-Balances -1460 USD
2026-10-01 * "Selected book bank"
  Assets:Bank 10810 RUB
  Equity:Opening-Balances -10810 RUB
`;
const local = `2026-10-11 * "Local cash"
  cashier_id: "synthetic-cash"
  Assets:Cash -5 USD
  Expenses:Food 5 USD
2026-10-11 * "Local bank"
  cashier_id: "synthetic-bank"
  Assets:Bank -9 RUB
  Expenses:Food 9 RUB
`;

async function seed(page: Page, caching: boolean) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ selected, local, caching, cache }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('settings', 'readwrite');
				for (const [key, value] of Object.entries({
					ledgerDataSource: 'beancount',
					userBookFilename: 'selected.bean',
					currency: 'USD',
					ledgerCacheEnabled: caching
				}))
					tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
			const root = await navigator.storage.getDirectory();
			for (const [name, content] of Object.entries({
				'selected.bean': selected,
				'cashier.bean': local
			})) {
				const file = await root.getFileHandle(name, { create: true });
				const writer = await file.createWritable();
				await writer.write(content);
				await writer.close();
			}
			// Real WASM binary for exactly this source composition, not mocked query data.
			const binary = await root.getFileHandle('ledger-cache.bin', { create: true });
			const writer = await binary.createWritable();
			await writer.write(new Uint8Array(cache));
			await writer.close();
		},
		{ selected, local, caching, cache }
	);
}

async function expectHistory(page: Page, account: string, balance: string) {
	const section = page.locator('article > section');
	await expect(section.locator('header')).toContainText(balance);
	await expect(
		section.getByText(`Selected book ${account.toLowerCase()}`, { exact: true })
	).toBeVisible();
	const localRow = section
		.getByRole('button')
		.filter({ hasText: `Local ${account.toLowerCase()}` });
	await expect(localRow).toHaveCount(1);
	await expect(localRow).toBeVisible();
	await expect(section.getByText('Records only on device')).toBeVisible();
	await expect(section.getByRole('alert')).toHaveCount(0);
}

for (const httpCache of [false, true]) {
	for (const viewport of [
		{ width: 1280, height: 900 },
		{ width: 390, height: 844 }
	]) {
		for (const caching of [false, true]) {
			test(`account history tree/reload/fresh page: ${viewport.width}px, ledger cache ${caching}, HTTP cache ${httpCache}`, async ({
				page,
				context
			}) => {
				await page.setViewportSize(viewport);
				const network = await context.newCDPSession(page);
				await network.send('Network.enable');
				await network.send('Network.setCacheDisabled', { cacheDisabled: !httpCache });
				await network.send('Network.setBypassServiceWorker', { bypass: true });
				const errors: string[] = [];
				page.on('pageerror', (error) => errors.push(error.message));
				let apiRequests = 0;
				context.on('request', (request) => {
					if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests++;
				});
				await seed(page, caching);
				for (const [account, balance] of [
					['Cash', '1,455USD'],
					['Bank', '10,801RUB']
				]) {
					await page.goto('/accounts/tree');
					await page.getByText(account, { exact: true }).click();
					await expect(page).toHaveURL(
						new RegExp(`/accounts/account-xacts/Assets(?:%3A|:)${account}`)
					);
					await expectHistory(page, account, balance);
					await page.reload();
					await expectHistory(page, account, balance);

					// A new document and worker, retaining this isolated origin's OPFS and IndexedDB.
					const direct = await context.newPage();
					await direct.setViewportSize(viewport);
					const directNetwork = await context.newCDPSession(direct);
					await directNetwork.send('Network.enable');
					await directNetwork.send('Network.setCacheDisabled', { cacheDisabled: !httpCache });
					await directNetwork.send('Network.setBypassServiceWorker', { bypass: true });
					direct.on('pageerror', (error) => errors.push(error.message));
					await direct.goto(`/accounts/account-xacts/${encodeURIComponent(`Assets:${account}`)}`);
					await expectHistory(direct, account, balance);
					await direct.close();
				}
				expect(apiRequests).toBe(0);
				expect(errors).toEqual([]);
			});
		}
	}
}
