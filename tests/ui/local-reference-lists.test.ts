import { expect, test, type Page } from '@playwright/test';
import { navigateFromDrawer as navigate } from './fixtures/navigation';

const apiBase = 'https://cashier.test/api';
const token = 'local-reference-test-only-token';
const declarations = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash
2000-01-01 open Assets:Declared USD, EUR
2000-01-01 open Assets:Unused CHF
2000-01-01 open Expenses:Food
2000-01-01 open Expenses:Completed USD
2000-01-01 open Expenses:Draft USD
`;
const downloaded = `2025-01-01 * "Book cafe" "Downloaded USD"
  Expenses:Food 20 USD
  Assets:Cash -20 USD
2025-01-02 * "Book euro" "Downloaded EUR"
  Expenses:Food 30 EUR
  Assets:Cash -30 EUR
`;
const completed = `2025-01-03 * "Completed cafe" "Completed local operation"
  Expenses:Completed 12.50 USD
  Assets:Cash -12.50 USD
`;
const draft = `2025-01-04 ! "Draft cafe" "Remaining local draft"
  Expenses:Draft 7 USD
  Assets:Cash -7 USD
`;
const initialBook = `${declarations}2000-01-01 open Expenses:OldOnly AUD\n${downloaded}`;
const freshBook = `${declarations}2000-01-01 open Expenses:Fresh GBP
${downloaded}2025-01-05 * "Fresh server merchant" "New server operation"
  Expenses:Fresh 9 GBP
  Assets:Cash -9 GBP
`;
const legacy = {
	accounts: [
		{ name: 'Assets:Cash', currencies: ['ZZZ'], balances: { ZZZ: 999 } },
		{ name: 'Assets:Declared', currencies: ['JPY'] },
		{ name: 'Assets:LegacyOnly', currencies: ['CAD'] }
	],
	payees: [{ name: 'Book cafe' }, { name: 'Legacy-only merchant' }]
};

async function readReferences(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const tx = db.transaction(['accounts', 'payees'], 'readonly');
				const accounts = tx.objectStore('accounts').getAll();
				const payees = tx.objectStore('payees').getAll();
				tx.oncomplete = () => resolve({ accounts: accounts.result, payees: payees.result });
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	});
}

async function readSources(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		return Object.fromEntries(
			await Promise.all(
				['cashier.bean', 'main.bean'].map(async (name) => [
					name,
					await (await (await root.getFileHandle(name)).getFile()).text()
				])
			)
		);
	});
}

async function seed(page: Page, caching: boolean) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ files, settings, legacy }) => {
			// Let the real application/Dexie create the schema; seed its existing stores directly.
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(['settings', 'accounts', 'payees'], 'readwrite');
					for (const [key, value] of Object.entries(settings)) {
						tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
					}
					for (const row of legacy.accounts) tx.objectStore('accounts').put(row);
					for (const row of legacy.payees) tx.objectStore('payees').put(row);
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.onabort = () => reject(tx.error);
				});
			} finally {
				db.close();
			}
			const root = await navigator.storage.getDirectory();
			for (const [name, source] of Object.entries(files)) {
				const writer = await (await root.getFileHandle(name, { create: true })).createWritable();
				await writer.write(source);
				await writer.close();
			}
		},
		{
			files: { 'cashier.bean': completed + draft, 'main.bean': initialBook },
			settings: {
				ledgerDataSource: 'beancount',
				userBookFilename: 'main.bean',
				ledgerCacheEnabled: caching,
				currency: 'USD',
				rememberLastTransaction: false,
				syncServerUrl: apiBase,
				syncApiToken: token,
				syncBeancountRootFile: 'main.bean'
			},
			legacy
		}
	);
	// Build the optional binary through the production worker/WASM, not a serialized test ledger.
	await page.goto('/util/validation');
	await page.getByRole('button', { name: 'Reload & Validate', exact: true }).click();
	await expect(page.getByText('Valid', { exact: true })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				try {
					return (await (await root.getFileHandle('ledger-cache.bin.json')).getFile()).size > 0;
				} catch (error) {
					if (error instanceof DOMException && error.name === 'NotFoundError') return false;
					throw error;
				}
			})
		)
		.toBe(caching);
	const references = await readReferences(page);
	expect(references).toEqual(legacy);
	return references;
}

async function assertAccounts(page: Page, afterSync = false) {
	const rows = page.locator('[role="listitem"]');
	await expect(
		rows.filter({ has: page.getByText('Assets:Unused', { exact: true }) })
	).toBeVisible();
	await expect.soft(rows).toHaveCount(7, { timeout: 500 });
	for (const name of [
		'Assets:Cash',
		'Assets:Declared',
		'Assets:Unused',
		'Expenses:Food',
		'Expenses:Completed',
		'Expenses:Draft',
		afterSync ? 'Expenses:Fresh' : 'Expenses:OldOnly'
	]) {
		await expect.soft(rows.filter({ has: page.getByText(name, { exact: true }) })).toHaveCount(1);
	}
	for (const name of ['Assets:Cash', 'Expenses:Food']) {
		const currencies = rows.filter({ has: page.getByText(name, { exact: true }) }).locator('span');
		expect
			.soft(
				(await currencies.allTextContents())
					.join('')
					.split(',')
					.map((value) => value.trim())
					.sort()
			)
			.toEqual(afterSync && name === 'Assets:Cash' ? ['EUR', 'GBP', 'USD'] : ['EUR', 'USD']);
	}
	const declared = rows.filter({ hasText: 'Assets:Declared' }).locator('span');
	expect
		.soft(
			(await declared.allTextContents())
				.join('')
				.split(',')
				.map((value) => value.trim())
				.sort()
		)
		.toEqual(['EUR', 'USD']);
	await expect.soft(rows.filter({ hasText: 'Assets:Unused' }).locator('span')).toHaveText('CHF');
	await expect.soft(rows.filter({ hasText: 'Assets:LegacyOnly' })).toHaveCount(0, { timeout: 500 });
	for (const row of await rows.all())
		await expect.soft(row).not.toContainText(/ZZZ|JPY/, { timeout: 500 });
}

async function assertPayees(page: Page, afterSync = false) {
	await expect(page.locator('[role="listitem"]').filter({ hasText: 'Book cafe' })).toBeVisible();
	await expect
		.soft(page.locator('[role="listitem"]'))
		.toHaveText(
			[
				'Book cafe',
				'Book euro',
				'Completed cafe',
				'Draft cafe',
				...(afterSync ? ['Fresh server merchant'] : [])
			],
			{ timeout: 500 }
		);
	await expect
		.soft(page.getByText('Legacy-only merchant', { exact: true }))
		.toHaveCount(0, { timeout: 500 });
}

async function assertQuery(page: Page, afterSync = false) {
	await page
		.locator('textarea')
		.fill('SELECT payee, narration, number, currency WHERE account ~ "^Expenses:" ORDER BY date');
	await page.getByRole('button', { name: 'Query', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Query', exact: true })).toBeEnabled();
	const rows = page.locator('tbody tr');
	await expect(rows).toHaveCount(afterSync ? 5 : 4);
	for (const [note, amount, currency] of [
		['Downloaded USD', '20', 'USD'],
		['Downloaded EUR', '30', 'EUR'],
		['Completed local operation', '12.50', 'USD'],
		['Remaining local draft', '7', 'USD'],
		...(afterSync ? [['New server operation', '9', 'GBP']] : [])
	]) {
		const row = rows.filter({ hasText: note });
		await expect(row).toHaveCount(1);
		await expect(row.getByRole('cell').nth(2)).toHaveText(amount);
		await expect(row.getByRole('cell').nth(3)).toHaveText(currency);
	}
}

async function synchronize(page: Page) {
	const button = page.getByRole('button', { name: 'Synchronize', exact: true });
	// Observe the complete busy/idle cycle even when the HTTP fixture answers before click returns.
	await button.evaluate((element) => {
		element.removeAttribute('data-test-sync-complete');
		let started = false;
		const observer = new MutationObserver((records) => {
			if (records.some((record) => record.oldValue === null)) started = true;
			if (started && !(element as HTMLButtonElement).disabled) {
				element.setAttribute('data-test-sync-complete', 'true');
				observer.disconnect();
			}
		});
		observer.observe(element, {
			attributes: true,
			attributeFilter: ['disabled'],
			attributeOldValue: true
		});
	});
	await button.click();
	await expect(button).toHaveAttribute('data-test-sync-complete', 'true');
	const diagnostics = page.locator('.card').filter({ hasText: 'Sync diagnostics' });
	await expect(diagnostics.getByText('Parse result', { exact: true }).locator('+ div')).toHaveText(
		'ok'
	);
	await expect(
		diagnostics.getByText('Display refresh', { exact: true }).locator('+ div')
	).toHaveText('ok');
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.addLocatorHandler(
		page.locator('.toast').filter({ hasText: 'App ready to work offline' }),
		async (toast) => {
			await toast.getByRole('button', { name: 'Close', exact: true }).click();
		}
	);
});

for (const caching of [true, false]) {
	test(`local lists ignore legacy rows; cold offline Journal, queries and editor controls; cache=${caching}`, async ({
		page,
		context
	}) => {
		test.setTimeout(60000);
		const apiRequests: string[] = [];
		context.on('request', (request) => {
			if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
		});
		const references = await seed(page, caching);
		await navigate(page, 'Accounts');
		await assertAccounts(page);
		await navigate(page, 'Payees');
		await assertPayees(page);
		await expect
			.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
			.toBe('activated');
		await page.reload();
		await expect
			.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
			.toBe(true);

		await context.setOffline(true);
		// A fresh document/worker with HTTP cache disabled must load via the production SW and OPFS.
		const cold = await context.newPage();
		const network = await context.newCDPSession(cold);
		await network.send('Network.setCacheDisabled', { cacheDisabled: true });
		try {
			const response = await cold.goto('/journal');
			expect(response?.fromServiceWorker()).toBe(true);
			await expect(cold.getByRole('main')).toContainText('Completed local operation');
			await expect(cold.getByRole('main')).toContainText('Remaining local draft');
			await cold.goto('/reports/query');
			await assertQuery(cold);
			await navigate(cold, 'Accounts');
			await assertAccounts(cold);
			await navigate(cold, 'Payees');
			await assertPayees(cold);

			await navigate(cold, 'Journal');
			await cold.getByText('Remaining local draft', { exact: false }).click();
			await cold.getByRole('button', { name: 'Edit', exact: true }).click();
			await expect(cold).toHaveURL(/\/tx$/);
			const originalPayee = await cold.getByTitle('Payee', { exact: true }).inputValue();
			await cold.getByTitle('Payee', { exact: true }).click();
			await expect(cold).toHaveURL(/\/payees$/);
			await cold.goBack();
			await expect(cold.getByTitle('Payee', { exact: true })).toHaveValue(originalPayee);
			await cold.getByTitle('Payee', { exact: true }).click();
			await assertPayees(cold);
			await cold.getByRole('searchbox').fill('Book cafe');
			await expect(cold.locator('[role="listitem"]')).toHaveText(['Book cafe']);
			await cold.locator('[role="listitem"]').click();
			await expect(cold).toHaveURL(/\/tx$/);
			await expect(cold.getByTitle('Payee', { exact: true })).toHaveValue('Book cafe');
			await cold.getByTitle('Payee', { exact: true }).click();
			await cold.getByRole('searchbox').fill('Authored free-text merchant');
			await expect(cold.locator('[role="listitem"]')).toHaveCount(0);
			await cold.locator('button.fixed').click();
			await expect(cold).toHaveURL(/\/tx$/);
			await expect(cold.getByTitle('Payee', { exact: true })).toHaveValue(
				'Authored free-text merchant'
			);
			const firstAccount = cold.getByTitle('Account', { exact: true }).first();
			const originalAccount = await firstAccount.inputValue();
			await firstAccount.click();
			await expect(cold).toHaveURL(/\/accounts$/);
			await cold.goBack();
			await expect(firstAccount).toHaveValue(originalAccount);
			await firstAccount.click();
			await assertAccounts(cold);
			await cold.locator('[role="listitem"]').filter({ hasText: 'Assets:Unused' }).click();
			await expect(cold).toHaveURL(/\/tx$/);
			await expect(cold.getByTitle('Account', { exact: true }).first()).toHaveValue(
				'Assets:Unused'
			);
			// Selection alone must neither create reference rows nor rewrite the authored journal.
			expect(await readReferences(cold)).toEqual(references);
			expect(await readSources(cold)).toEqual({
				'cashier.bean': completed + draft,
				'main.bean': initialBook
			});
			expect(apiRequests).toEqual([]);
		} finally {
			await cold.close();
			await context.setOffline(false);
		}
	});

	test(`mock HTTP full Sync refreshes warm lists and combined queries without duplicate entries; cache=${caching}`, async ({
		page
	}) => {
		test.setTimeout(60000);
		const requests: string[] = [];
		const posts: string[][] = [];
		const accepted = new Map<string, string>();
		page.on('request', (request) => {
			const url = new URL(request.url());
			if (url.pathname.startsWith('/api/'))
				requests.push(`${request.method()} ${url.pathname}${url.search}`);
		});
		// Only the server is mocked: the real app sends, validates, replaces OPFS, reconciles and reloads WASM.
		await page.route(`${apiBase}/**`, async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			expect(request.headers().authorization).toBe(`Bearer ${token}`);
			if (request.method() === 'POST' && url.pathname === '/api/xact') {
				const { transactions } = request.postDataJSON() as { transactions: string[] };
				posts.push(transactions);
				const synchronized = transactions.map((source) => {
					const id = source.match(/^\s+cashier_id:\s*"([^"]+)"/m)?.[1];
					expect(id).toBeTruthy();
					accepted.set(id!, source);
					return id;
				});
				await route.fulfill({ json: { synchronized, rejected: [] } });
			} else if (request.method() === 'GET' && url.pathname === '/api/infrastructure') {
				expect(url.searchParams.get('file_path')).toBe('main.bean');
				await route.fulfill({ json: { content: freshBook + [...accepted.values()].join('\n') } });
			} else {
				await route.abort('failed');
			}
		});
		const references = await seed(page, caching);
		await navigate(page, 'Accounts');
		await assertAccounts(page);
		await navigate(page, 'Payees');
		await assertPayees(page);
		await navigate(page, 'Server Sync');
		expect(requests).toEqual([]);
		await synchronize(page);
		expect(requests).toEqual(['POST /api/xact', 'GET /api/infrastructure?file_path=main.bean']);
		expect(posts).toHaveLength(1);
		expect(posts[0]).toHaveLength(1);
		expect(posts[0][0]).toContain('Completed local operation');
		expect(posts[0][0]).not.toContain('Remaining local draft');
		expect(accepted.size).toBe(1);
		const sources = await readSources(page);
		expect(sources['cashier.bean']).toContain(draft);
		expect(sources['cashier.bean']).not.toContain('Completed local operation');
		expect(sources['cashier.bean']).not.toContain('cashier_id:');
		expect(sources['cashier.bean'].match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(1);
		expect(sources['main.bean'].match(/cashier_id:/g)).toHaveLength(1);
		await navigate(page, 'Accounts');
		await assertAccounts(page, true);
		await expect(
			page.locator('[role="listitem"]').filter({ hasText: 'Expenses:OldOnly' })
		).toHaveCount(0);
		await navigate(page, 'Payees');
		await assertPayees(page, true);
		await navigate(page, 'Journal');
		await expect(page.getByRole('main')).toContainText('Remaining local draft');
		await expect(page.getByRole('main')).not.toContainText('Completed local operation');
		await navigate(page, 'Server Sync');
		await synchronize(page);
		expect(posts).toHaveLength(1);
		expect(requests).toEqual([
			'POST /api/xact',
			'GET /api/infrastructure?file_path=main.bean',
			'GET /api/infrastructure?file_path=main.bean'
		]);
		expect(await readSources(page)).toEqual(sources);
		expect(await readReferences(page)).toEqual(references);
		// New document/worker also sees the durable post-reconciliation composition/cache.
		await page.goto('/reports/query');
		await assertQuery(page, true);
		await navigate(page, 'Accounts');
		await assertAccounts(page, true);
		await navigate(page, 'Payees');
		await assertPayees(page, true);
		expect(await readReferences(page)).toEqual(references);
		expect(requests).toHaveLength(3);
	});
}
