import { expect, test, type Page } from '@playwright/test';

const book = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash USD, EUR
2000-01-01 open Assets:Bank:Checking USD
2000-01-01 open Expenses:Food USD

2000-01-01 open Equity:Opening-Balances USD, EUR
2025-01-02 * "Shop" ""
  Expenses:Food  10 USD
  Assets:Cash  -10 USD
2025-01-02 * "" "Shop"
  Expenses:Food  11 USD
  Assets:Cash  -11 USD
2025-01-02 * "A:B" "C"
  Expenses:Food  12 USD
  Assets:Cash  -12 USD
2025-01-02 * "A" "B:C"
  Expenses:Food  13 USD
  Assets:Cash  -13 USD
2025-01-03 * "Exchange"
  Assets:Cash  5 EUR
  Equity:Opening-Balances  -5 EUR
`;

async function seedBook(page: Page) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(async (content) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction('settings', 'readwrite');
			for (const [key, value] of Object.entries({
				ledgerDataSource: 'beancount',
				userBookFilename: 'main.bean',
				currency: 'USD',
				ledgerCacheEnabled: false,
				favouriteAccounts: ['Assets:Cash'],
				accountGroups: [{ title: 'Cash accounts', accounts: ['Assets:Cash'] }]
			})) {
				transaction.objectStore('settings').put({ key, value: JSON.stringify(value) });
			}
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		db.close();

		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('main.bean', { create: true });
		const writer = await handle.createWritable();
		await writer.write(content);
		await writer.close();
		const local = await root.getFileHandle('cashier.bean', { create: true });
		const localWriter = await local.createWritable();
		await localWriter.write('');
		await localWriter.close();
	}, book);
	await page.reload();
}

test('account tree expands and collapses descendants after loading ledger accounts', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await seedBook(page);
	await page.goto('/accounts/tree');

	const root = page.getByText('Assets', { exact: true });
	await expect(root).toBeVisible();
	await page.getByRole('button', { name: 'Collapse' }).first().click();
	await expect(page.getByText('Cash', { exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Expand' }).first().click();
	await expect(page.getByText('Cash', { exact: true })).toBeVisible();
	const bank = page.getByText('Bank', { exact: true });
	await expect(bank).toBeVisible();
	await bank.locator('xpath=preceding-sibling::button').click();
	await expect(page.getByText('Checking', { exact: true })).toBeVisible();
	await expect(errors).toEqual([]);
});

test('transaction search retains separate rows for identical display labels and colon-delimited identities', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await seedBook(page);
	await page.goto('/reports/tx-search');
	await page.getByLabel('Account', { exact: true }).fill('Expenses:Food');
	await page.getByRole('button', { name: 'Search' }).click();

	const rows = page.locator('section > div.flex.flex-col.divide-y > div.py-2');
	await expect(rows).toHaveCount(4);
	for (const amount of ['10 USD', '11 USD', '12 USD', '13 USD']) {
		await expect(rows.filter({ hasText: amount })).toHaveCount(1);
	}
	await expect(rows.filter({ hasText: '12 USD' })).toContainText('C');
	await expect(rows.filter({ hasText: '13 USD' })).toContainText('A');
	await expect(rows.filter({ hasText: '10 USD' })).toContainText('Shop');
	await expect(rows.filter({ hasText: '11 USD' })).toContainText('Shop');
	await expect(errors).toEqual([]);
});

test('BQL results preserve duplicate column names and update subsequent results', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await seedBook(page);
	await page.goto('/reports/query');

	const query = page.getByPlaceholder('Enter BQL query...');
	const run = page.getByRole('button', { name: 'Query', exact: true });
	const table = page.locator('table');
	await query.fill("SELECT number, currency WHERE account = 'Expenses:Food' ORDER BY number");
	await run.click();
	await expect(table.locator('th')).toHaveText(['number', 'currency']);
	await expect(table.locator('tbody tr')).toHaveCount(4);

	await query.fill(
		"SELECT number AS amount, currency AS amount WHERE account = 'Expenses:Food' AND number = 10"
	);
	await run.click();
	await expect(table.locator('th')).toHaveText(['amount', 'amount']);
	await expect(table.locator('tbody tr')).toHaveCount(1);
	await expect(table.locator('tbody td')).toHaveText(['10', 'USD']);

	await query.fill(
		"SELECT currency AS amount, number AS amount, account AS amount WHERE account = 'Expenses:Food' AND number = 13"
	);
	await run.click();
	await expect(table.locator('th')).toHaveText(['amount', 'amount', 'amount']);
	await expect(table.locator('tbody tr')).toHaveCount(1);
	await expect(table.locator('tbody td')).toHaveText(['USD', '13', 'Expenses:Food']);
	await expect(errors).toEqual([]);
});

for (const route of ['/favourites', '/accounts/groups']) {
	test(`account balance keyboard controls do not navigate on ${route}`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => errors.push(error.message));
		await seedBook(page);
		await page.goto(route);

		const row = page.locator('[role="button"]').filter({ hasText: 'Cash' });
		const balance = row.getByRole('button', { name: /USD.*…/ });
		await expect(balance).toBeVisible();
		await expect(row).not.toContainText('EUR');
		await balance.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(route);
		await expect(row).toContainText('EUR');
		await page.keyboard.press('Space');
		await expect(row).not.toContainText('EUR');
		await expect(page).toHaveURL(route);
		await balance.click();
		await expect(row).toContainText('EUR');
		await expect(page).toHaveURL(route);

		await row.focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/accounts\/account-xacts\//);
		await expect(errors).toEqual([]);
	});
}

test('asset currency controls stay sibling buttons and expand balances without navigating', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await seedBook(page);
	await page.goto('/reports/assets');

	await page.getByRole('button', { name: 'Original' }).click();
	const cash = page.getByRole('button', { name: /Cash/ });
	await expect(cash).toBeVisible();
	const cashRow = cash.locator('xpath=..');
	const balanceButton = cashRow.getByRole('button', { name: /USD.*…/ });
	await expect(balanceButton).toBeVisible();
	expect(
		await cash.evaluate((element) => {
			const row = element.parentElement;
			return (
				row?.tagName === 'DIV' &&
				row.contains(document.activeElement) === false &&
				row.querySelectorAll(':scope > button').length === 1 &&
				row.querySelectorAll(':scope > div > button').length === 1
			);
		})
	).toBe(true);
	await balanceButton.focus();
	await page.keyboard.press('Enter');
	await expect(cashRow).toContainText('EUR');
	await expect(page).toHaveURL(/reports\/assets/);
	await expect(errors).toEqual([]);
});
