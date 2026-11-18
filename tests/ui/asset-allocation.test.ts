import { expect, test, type Page } from '@playwright/test';

const definition = `[Allocation]
allocation = 100

[Allocation.Equity]
allocation = 100
symbols = ["FUND"]
`;

const journal = `option "operating_currency" "EUR"
2000-01-01 open Assets:Investments:Fund FUND
2000-01-01 open Assets:Cash EUR
2025-01-01 * "Buy fund"
  Assets:Investments:Fund  1 FUND {10 EUR}
  Assets:Cash            -10 EUR
2025-02-01 * "Sell fund"
  Assets:Investments:Fund  -1 FUND {10 EUR}
  Assets:Cash              10 EUR
`;

async function seedAllocation(page: Page, path?: string, content?: string) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ path, content, journal }) => {
			const root = await navigator.storage.getDirectory();
			const files: Record<string, string> = { 'cashier.bean': journal };
			if (path && content !== undefined) files[path] = content;
			for (const [name, source] of Object.entries(files)) {
				const file = await root.getFileHandle(name, { create: true });
				const writer = await file.createWritable();
				await writer.write(source);
				await writer.close();
			}

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = db.transaction('settings', 'readwrite');
				const store = transaction.objectStore('settings');
				store.put({ key: 'currency', value: JSON.stringify('EUR') });
				store.put({ key: 'aa.rootAccount', value: JSON.stringify('Assets:Investments') });
				if (path) store.put({ key: 'aa.definition', value: JSON.stringify(path) });
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
			db.close();
		},
		{ path, content, journal }
	);
}

async function validateAllocation(page: Page) {
	await page.locator('.navbar .dropdown > button').click();
	await page.getByRole('menu').getByRole('button', { name: 'Validate', exact: true }).click();
}

test('Asset Class Detail opens from the cold list and on direct reload without journal validation', async ({
	page
}) => {
	await seedAllocation(page, 'allocation.toml', definition);
	await page.goto('/asset-allocation');
	await page.reload();
	await page.getByRole('link', { name: 'Equity', exact: true }).click();
	await expect(page).toHaveURL(/\/assetclass-detail\/Allocation(?::|%3A)Equity$/i);

	const assets = page.getByRole('main');
	for (let attempt = 0; attempt < 2; attempt++) {
		await expect(assets.getByText('Asset Class Detail', { exact: true })).toBeVisible();
		await expect(assets.getByText('Allocation: 100', { exact: true })).toBeVisible();
		await expect(assets.getByText('0.00 EUR, n/a', { exact: true })).toBeVisible();
		await expect(assets).not.toContainText(/NaN%|Infinity%|Error loading analysis/);
		if (attempt === 0) await page.reload();
	}
});

test('Asset Allocation Help opens the setup instructions and a loaded definition validates', async ({
	page
}) => {
	await seedAllocation(page, 'allocation.toml', definition);
	await page.goto('/asset-allocation');
	await expect(page.getByRole('link', { name: 'Equity', exact: true })).toBeVisible();
	await validateAllocation(page);
	await expect(page.locator('#toast-container .alert-success')).toContainText(
		'The allocation is valid.'
	);
	await page.locator('.navbar .dropdown > button').click();
	await page.getByRole('menu').getByRole('link', { name: 'Help', exact: true }).click();
	await expect(page).toHaveURL(/\/help#asset-allocation$/);
	await expect(page.getByRole('heading', { name: 'Set up Asset Allocation' })).toBeInViewport();
	await expect(page.getByText('symbols = ["VTI"]', { exact: false })).toBeVisible();
});

for (const { path, content, reason } of [
	{
		path: undefined,
		content: undefined,
		reason: 'No asset allocation definition file is selected.'
	},
	{
		path: 'missing.toml',
		content: undefined,
		reason: 'Could not open asset allocation definition "missing.toml".'
	},
	{
		path: 'invalid.toml',
		content: '[Allocation',
		reason: 'Could not load asset allocation definition "invalid.toml":'
	},
	{ path: 'empty.toml', content: '', reason: 'Asset allocation definition is empty' }
]) {
	test(`Asset Allocation Validate reports ${path ?? 'no selected file'} without false success`, async ({
		page
	}) => {
		await seedAllocation(page, path, content);
		await page.goto('/asset-allocation');
		await expect(page.getByRole('cell').filter({ hasText: reason })).toBeVisible();
		await validateAllocation(page);
		await expect(page.locator('#toast-container .alert-error')).toContainText(reason);
		await expect(page.getByText('The allocation is valid.', { exact: true })).toHaveCount(0);
	});
}
