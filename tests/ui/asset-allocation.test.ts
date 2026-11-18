import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { navigateFromDrawer } from './fixtures/navigation';

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

async function seedAllocation(
	page: Page,
	path?: string,
	content?: string,
	{ source = journal, currency = 'EUR' } = {}
) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ path, content, source, currency }) => {
			const root = await navigator.storage.getDirectory();
			const files: Record<string, string> = { 'cashier.bean': source };
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
				store.put({ key: 'currency', value: JSON.stringify(currency) });
				store.put({ key: 'aa.rootAccount', value: JSON.stringify('Assets:Investments') });
				if (path) store.put({ key: 'aa.definition', value: JSON.stringify(path) });
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
			db.close();
		},
		{ path, content, source, currency }
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
		await expect(assets.getByText('n/a', { exact: true })).toBeVisible();
		await expect(assets).not.toContainText(/NaN%|Infinity%|Error loading analysis/);
		if (attempt === 0) await page.reload();
	}
});

test('Asset Class Detail shows USD gain when the GBP yield query fails', async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
	await seedAllocation(page, 'allocation.toml', definition, {
		currency: 'GBP',
		source: `option "operating_currency" "GBP"
2000-01-01 open Assets:Investments:Fund FUND
2000-01-01 open Assets:Cash USD
2000-01-01 open Income:Dividend:FUND USD
2026-01-01 price FUND 60 USD
2026-01-01 * "Buy fund"
  Assets:Investments:Fund  1 FUND {50 USD}
  Assets:Cash            -50 USD
2026-06-01 * "Dividend"
  Income:Dividend:FUND  -2 USD
  Assets:Cash            2 USD
`
	});
	await page.goto('/asset-allocation');
	await page.getByRole('link', { name: 'Equity', exact: true }).click();
	await expect(page).toHaveURL(/\/assetclass-detail\/Allocation(?::|%3A)Equity$/i);

	const card = page
		.getByRole('listitem')
		.filter({ has: page.getByRole('heading', { name: '• FUND', exact: true }) });
	await expect(card).toContainText('Yield: n/a');
	await expect(card).toContainText('Could not calculate yield: BQL query failed:');
	await expect(card).toContainText('Gain/Loss: 10.00 USD, 20.00%');
	await expect(card).not.toContainText('Error loading analysis');
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

test('Asset Allocation exports the loaded class hierarchy', async ({ page }) => {
	await seedAllocation(page, 'allocation.toml', definition);
	await page.goto('/asset-allocation');
	await expect(page.getByRole('link', { name: 'Equity', exact: true })).toBeVisible();
	await page.locator('.navbar .dropdown > button').click();
	const download = page.waitForEvent('download');
	await page.getByRole('menu').getByRole('button', { name: 'Export', exact: true }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^asset-allocation_.*\.txt$/);
	expect(await readFile(await file.path(), 'utf8')).toMatch(
		/\nAllocation\s+100[^\n]*\n\s+Equity\s+100/
	);
});

test('Asset Allocation Validate rejects a previously loaded definition deleted via File Storage', async ({
	page
}) => {
	const path = 'allocation.toml';
	await seedAllocation(page, path, definition);
	await page.goto('/asset-allocation');
	await expect(page.getByRole('link', { name: 'Equity', exact: true })).toBeVisible();

	await navigateFromDrawer(page, 'File Storage');
	const file = page.getByRole('row').filter({ hasText: path });
	await file.getByRole('button').click();
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(file).toHaveCount(0);
	await page.goBack();
	await expect(page).toHaveURL('/asset-allocation');

	await validateAllocation(page);
	await expect(page.locator('#toast-container .alert-error')).toContainText(
		`Could not open asset allocation definition "${path}".`
	);
	await expect(page.getByText('The allocation is valid.', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Equity', exact: true })).toHaveCount(0);
});

test('Asset Allocation Validate checks updated TOML contents at the same path', async ({
	page
}) => {
	const path = 'allocation.toml';
	await seedAllocation(page, path, definition);
	await page.goto('/asset-allocation');
	await expect(page.getByRole('link', { name: 'Equity', exact: true })).toBeVisible();

	// Change the definition in storage while the report is still showing the cached allocation.
	await page.evaluate(
		async ({ path, updated }) => {
			const root = await navigator.storage.getDirectory();
			const file = await root.getFileHandle(path);
			const writer = await file.createWritable();
			await writer.write(updated);
			await writer.close();
		},
		{
			path,
			updated: definition.replace(
				'[Allocation.Equity]\nallocation = 100',
				'[Allocation.Equity]\nallocation = 70'
			)
		}
	);

	await validateAllocation(page);
	await expect(page.locator('#toast-container .alert-error')).toContainText(
		"'Allocation' does not match the sum of child classes"
	);
	await expect(page.getByText('The allocation is valid.', { exact: true })).toHaveCount(0);
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
