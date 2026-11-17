import { expect, test, type Locator, type Page } from '@playwright/test';
import { navigateFromDrawer } from './fixtures/navigation';

const entry = (description: string, amount = 5) => `2026-10-01 * "${description}"
  Expenses:Food ${amount} USD
  Assets:Cash -${amount} USD
`;
const files = {
	'cashier.bean': entry('Pending local overlay', 7),
	'main.bean': `option "operating_currency" "USD"
2000-01-01 open Assets:Cash USD
2000-01-01 open Expenses:Food USD
include "included.bean"
${entry('Selected book transaction', 20)}`,
	'included.bean': entry('Included book transaction', 30),
	'unselected.bean': entry('Unselected book must not appear', 99),
	'unrelated.txt': 'Keep this text unchanged.\n'
};

async function writeFiles(page: Page, sources: Record<string, string>) {
	await page.evaluate(async (sources) => {
		const root = await navigator.storage.getDirectory();
		for (const [name, content] of Object.entries(sources)) {
			const writer = await (await root.getFileHandle(name, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
	}, sources);
}

async function seed(page: Page, sources = files) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await writeFiles(page, sources);
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
					userBookFilename: 'main.bean',
					ledgerCacheEnabled: false,
					currency: 'USD'
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
	});
}

async function expectSources(page: Page, expected = files) {
	const actual = await page.evaluate(async (names) => {
		const root = await navigator.storage.getDirectory();
		return Object.fromEntries(
			await Promise.all(
				names.map(async (name) => [
					name,
					await (await (await root.getFileHandle(name)).getFile()).text()
				])
			)
		);
	}, Object.keys(expected));
	expect(actual).toEqual(expected);
}

// Expand the real JSON tree through its controls, not a mocked service response.
async function expandTree(section: Locator) {
	const nodes = section.locator('button');
	for (let index = 1; index < (await nodes.count()); index++) {
		await nodes.nth(index).click();
	}
}

async function openInspector(page: Page) {
	await page.getByRole('link', { name: 'Inspect parsed ledger', exact: true }).click();
	await expect(page).toHaveURL('/ledger/multi');
	await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
	await expect(page.getByText('Parsed', { exact: true })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: 'Full local analysis book', exact: true })
	).toBeVisible();
	await expect(page.getByRole('main').last()).not.toContainText('parseMultiFile');
	await page.getByRole('button', { name: /^Directives \(/ }).click();
	const directives = page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: /^Directives \(/ }) });
	await expandTree(directives);
	return directives;
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
});

test('Validation opens the full book inspector and back retains validation and Journal workflows without source writes', async ({
	page
}) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await seed(page);
	await page.goto('/journal');
	await expect(page.getByRole('main')).toContainText('Pending local overlay');
	await navigateFromDrawer(page, 'Validation');
	await expect(page.getByText('All clear!', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Inspect parsed ledger' })).toHaveAttribute(
		'href',
		'/ledger/multi'
	);

	const directives = await openInspector(page);
	for (const description of [
		'Pending local overlay',
		'Selected book transaction',
		'Included book transaction'
	]) {
		await expect(directives).toContainText(description);
	}
	await expect(directives).not.toContainText('Unselected book must not appear');
	await page.getByRole('button', { name: /^Parse Errors \(0\)/ }).click();
	await expect(page.getByRole('button', { name: 'errors [0]', exact: true })).toBeVisible();
	await expectSources(page);

	await page.goBack();
	await expect(page).toHaveURL('/util/validation');
	await page.getByRole('button', { name: 'Reload & Validate', exact: true }).click();
	await expect(page.getByText('All clear!', { exact: true })).toBeVisible();
	await expectSources(page);
	await navigateFromDrawer(page, 'Journal');
	await expect(page.getByRole('main')).toContainText('Pending local overlay');
	await expectSources(page);
	expect(pageErrors).toEqual([]);
});

test('full inspector exposes diagnostics and Reload refreshes the selected book without changing sources', async ({
	page
}) => {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	const invalid = {
		...files,
		'included.bean':
			files['included.bean'] +
			`2026-10-02 ! "Incomplete book entry"
  Expenses:Food
  Assets:Cash
`
	};
	await seed(page, invalid);
	await page.goto('/util/validation');
	await expect(page.getByText('Invalid', { exact: true })).toBeVisible();
	const validationMessage = await page.locator('tbody tr td:last-child').first().innerText();
	expect(validationMessage.trim()).not.toBe('');
	const directives = await openInspector(page);
	await expect(directives).toContainText('Incomplete book entry');
	await expect(directives).toContainText('Pending local overlay');
	await page.getByRole('button', { name: /^Parse Errors \([1-9]/ }).click();
	const diagnostics = page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: /^Parse Errors \(/ }) });
	await expandTree(diagnostics);
	await expect(diagnostics).toContainText(validationMessage);
	await expectSources(page, invalid);

	// Change only the test-owned included source; Reload must read it afresh.
	const refreshed = { ...files, 'included.bean': entry('Reloaded included transaction', 42) };
	await writeFiles(page, { 'included.bean': refreshed['included.bean'] });
	await page.getByRole('button', { name: 'Reload', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeEnabled();
	await expect(page.getByText('Parsed', { exact: true })).toBeVisible();
	await expect(diagnostics.getByRole('heading')).toHaveText('Parse Errors (0)');
	await expandTree(directives);
	await expect(directives).toContainText('Reloaded included transaction');
	await expect(directives).toContainText('Pending local overlay');
	await expect(directives).toContainText('Selected book transaction');
	await expect(directives).not.toContainText('Incomplete book entry');
	await expectSources(page, refreshed);
	await page.goBack();
	await page.getByRole('button', { name: 'Reload & Validate', exact: true }).click();
	await expect(page.getByText('All clear!', { exact: true })).toBeVisible();
	await expectSources(page, refreshed);
	expect(pageErrors).toEqual([]);
});

test('retired /ledger offers no local inspector and leaves the Journal and selected book intact', async ({
	page
}) => {
	await seed(page);
	await page.goto('/ledger');
	await expect(page.getByRole('heading', { name: '404', exact: true })).toBeVisible();
	await expect(page.getByText('ParsedLedger Inspector', { exact: true })).toHaveCount(0);
	await expect(page.getByText('Ledger Debug', { exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
	await expectSources(page);
	await page.goto('/util/validation');
	const directives = await openInspector(page);
	await expect(directives).toContainText('Pending local overlay');
	await expect(directives).toContainText('Selected book transaction');
	await expectSources(page);
});
