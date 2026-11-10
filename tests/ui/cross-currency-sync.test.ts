import { expect, test, type Page } from '@playwright/test';
import { navigateFromDrawer } from './fixtures/navigation';

const apiBase = 'https://cashier.test/api';
const token = 'cross-currency-mock-only-token';
const accounts = `option "operating_currency" "USD"
2000-01-01 open Assets:GBP GBP
2000-01-01 open Assets:USD USD
`;
const exchange = `2025-01-02 * "Exchange" "Confirmed exchange"
  cashier_id: "exchange-browser-id"
  receipt: "original.pdf"
  Assets:GBP  -10 GBP @@ 12.30 USD ; spent
  Assets:USD  12.30 USD ; received
`;
const incomplete = `2025-01-03 ! "Exchange" "Incomplete exchange"
  cashier_id: "incomplete-browser-id"
  Assets:GBP  -3 GBP @@ 10.00 USD
  Assets:USD  10.00 USD
`;

async function readFile(page: Page, name = 'cashier.bean') {
	return page.evaluate(async (name) => {
		const root = await navigator.storage.getDirectory();
		return (await (await root.getFileHandle(name)).getFile()).text();
	}, name);
}

async function seed(page: Page) {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.addLocatorHandler(
		page.locator('.toast').filter({ hasText: 'App ready to work offline' }),
		async (toast) =>
			toast.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click')
	);
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ accounts, journal, apiBase, token }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('settings', 'readwrite');
				for (const [key, value] of Object.entries({
					ledgerDataSource: 'beancount',
					syncServerUrl: apiBase,
					syncApiToken: token,
					syncBeancountRootFile: 'main.bean',
					syncLedgerFiles: true,
					syncAccounts: false,
					syncPayees: false,
					ledgerCacheEnabled: false,
					userBookFilename: 'main.bean'
				}))
					tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
			const root = await navigator.storage.getDirectory();
			for (const [name, content] of Object.entries({
				'main.bean': accounts,
				'cashier.bean': journal
			})) {
				const file = await root.getFileHandle(name, { create: true });
				const writer = await file.createWritable();
				await writer.write(content);
				await writer.close();
			}
		},
		{ accounts, journal: exchange + '\n' + incomplete, apiBase, token }
	);
	await page.reload();
	await page.goto('/sync');
	await expect(page.getByRole('button', { name: 'Synchronize', exact: true })).toBeEnabled();
	await expect(page.getByLabel('Send → pull → reconcile')).toBeChecked();
}

async function startSync(page: Page) {
	const button = page.getByRole('button', { name: 'Synchronize', exact: true });
	await button.evaluate((element) => {
		element.removeAttribute('data-test-sync-complete');
		let started = false;
		const observer = new MutationObserver((records) => {
			for (const record of records) if (record.oldValue === null) started = true;
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
}

async function finishSync(page: Page) {
	await expect(page.getByRole('button', { name: 'Synchronize', exact: true })).toHaveAttribute(
		'data-test-sync-complete',
		'true'
	);
}

test('mock API only: @@ retries stay raw, rejection vetoes removal, and confirmed refresh shows one operation', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const posts: string[][] = [];
	const unexpected: string[] = [];
	let attempt = 0;
	let pullStarted = false;
	let releasePull: (() => void) | undefined;
	const pullGate = new Promise<void>((resolve) => {
		releasePull = resolve;
	});

	// Deliberately scripted responses: this verifies the client contract, not server validation/deduplication.
	await page.route(`${apiBase}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		expect(request.headers().authorization).toBe(`Bearer ${token}`);
		if (request.method() === 'POST' && url.pathname === '/api/xact') {
			attempt++;
			const payload = request.postDataJSON();
			expect(payload).toEqual({ transactions: [exchange.trimEnd()] });
			posts.push(payload.transactions);
			expect(await readFile(page)).toBe(exchange + '\n' + incomplete);
			await route.fulfill({
				json:
					attempt === 3
						? {
								synchronized: [],
								rejected: [{ cashier_id: 'exchange-browser-id', reason: 'Mock same-ID conflict' }]
							}
						: { synchronized: ['exchange-browser-id'], rejected: [] }
			});
			return;
		}
		if (request.method() === 'GET' && url.pathname === '/api/infrastructure') {
			expect(url.searchParams.get('file_path')).toBe('main.bean');
			if (attempt === 1) {
				await route.fulfill({ status: 503, body: 'Mock pull unavailable' });
				return;
			}
			if (attempt === 4) {
				pullStarted = true;
				await pullGate;
			}
			await route.fulfill({ json: { content: accounts + (attempt >= 3 ? exchange : '') } });
			return;
		}
		unexpected.push(`${request.method()} ${request.url()}`);
		await route.abort('failed');
	});
	await seed(page);

	await startSync(page);
	await finishSync(page);
	await expect(page.getByRole('alert')).toContainText('HTTP 503');
	expect(await readFile(page)).toBe(exchange + '\n' + incomplete);

	// A successful acknowledgement with no matching transaction in the pulled book is insufficient.
	await startSync(page);
	await finishSync(page);
	expect(await readFile(page)).toBe(exchange + '\n' + incomplete);
	expect(await readFile(page, 'main.bean')).toBe(accounts);

	// Rejection vetoes deletion even if this pull includes the same completed transaction ID.
	await startSync(page);
	await finishSync(page);
	await expect(page.getByRole('alert')).toContainText('Mock same-ID conflict');
	expect(await readFile(page)).toBe(exchange + '\n' + incomplete);
	expect(await readFile(page, 'main.bean')).toBe(accounts + exchange);

	await startSync(page);
	await expect.poll(() => pullStarted).toBe(true);
	await expect(page.getByRole('button', { name: 'Synchronize', exact: true })).toBeDisabled();
	// POST has acknowledged, but the current authoritative pull has not completed.
	expect(await readFile(page)).toBe(exchange + '\n' + incomplete);
	releasePull!();
	await finishSync(page);
	expect((await readFile(page)).trim()).toBe(incomplete.trim());
	expect(posts).toEqual(Array.from({ length: 4 }, () => [exchange.trimEnd()]));
	expect(await readFile(page, 'main.bean')).toBe(accounts + exchange);

	await navigateFromDrawer(page, 'Account Tree');
	await page.getByText('USD', { exact: true }).click();
	await expect(page).toHaveURL(/\/accounts\/account-xacts\/Assets(?:%3A|:)USD$/);
	const history = page.locator('article > section');
	await expect(history.getByText('Exchange | Confirmed exchange', { exact: true })).toHaveCount(1);
	await expect(history.locator('header')).toContainText('22.30USD');
	await expect(history.getByRole('button').filter({ hasText: 'Incomplete exchange' })).toHaveCount(
		1
	);
	await expect(history.getByRole('alert')).toHaveCount(0);
	await page.reload();
	await expect(history.getByText('Exchange | Confirmed exchange', { exact: true })).toHaveCount(1);
	await expect(history.getByRole('button').filter({ hasText: 'Incomplete exchange' })).toHaveCount(
		1
	);
	expect((await readFile(page)).trim()).toBe(incomplete.trim());
	expect(unexpected).toEqual([]);
	expect(errors).toEqual([]);
});
