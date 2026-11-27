import { expect, test, type Page } from '@playwright/test';
import { waitForOfflineControl } from './fixtures/offline';

const journal = `option "operating_currency" "EUR"
2000-01-01 open Assets:Checking
2000-01-01 open Assets:Savings
2000-01-01 open Equity:Opening
2025-01-01 * "Opening balances"
  Assets:Checking 198.28 EUR
  Assets:Checking 20 USD
  Assets:Savings 100 EUR
  Equity:Opening -298.28 EUR
  Equity:Opening -20 USD
`;

async function seedBook(page: Page, source = journal) {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'New transaction' })).toBeVisible();
	await page.evaluate(async (source) => {
		const root = await navigator.storage.getDirectory();
		const file = await root.getFileHandle('cashier.bean', { create: true });
		const writer = await file.createWritable();
		await writer.write(source);
		await writer.close();
	}, source);
	await page.reload();
}

async function keys(page: Page, ...labels: string[]) {
	for (const name of labels) await page.getByRole('button', { name, exact: true }).click();
}

const result = (page: Page) => page.getByRole('status', { name: 'Calculator result' });
const picker = (page: Page) => page.getByRole('dialog', { name: 'Insert account balance' });

test('calculator picks original balances from different accounts offline', async ({
	page,
	context
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await seedBook(page);
	await waitForOfflineControl(page);
	await page.goto('/calculator');
	await context.setOffline(true);
	await keys(page, 'Insert account balance');
	const savings = picker(page).getByRole('button', { name: 'Assets:Savings' });
	await expect(savings).toBeVisible();
	await picker(page).getByRole('searchbox', { name: 'Search accounts' }).fill('Checking');
	await expect(savings).toHaveCount(0);
	await keys(page, 'Assets:Checking');
	await expect(picker(page).getByRole('button', { name: '20 USD' })).toBeVisible();
	await keys(page, '198.28 EUR', '-', 'Insert account balance', 'Assets:Savings', '100 EUR', '=');
	await expect(result(page)).toHaveText('98.28');
	await keys(page, 'AC', '2', '+', '3');
	const operand = page.getByRole('button', { name: 'Select operand 1: 2' });
	const bounds = await operand.boundingBox();
	expect(bounds?.width).toBeGreaterThanOrEqual(44);
	expect(bounds?.height).toBeGreaterThanOrEqual(44);
	await operand.click();
	await expect(operand).toHaveAttribute('aria-pressed', 'true');
	const balanceKey = page.getByRole('button', { name: 'Insert account balance', exact: true });
	await expect(balanceKey.locator('img')).toHaveAttribute('src', '/icons/cashier-logo.svg');
	await balanceKey.click();
	await expect(picker(page)).toBeVisible();
});

test('transaction calculator handles an entered amount, scopes balance lookup and applies only the result', async ({
	page
}) => {
	await seedBook(page);
	await page.getByRole('button', { name: 'New transaction' }).click();
	await expect(page).toHaveURL(/\/tx$/);
	await page.getByTitle('Account', { exact: true }).first().click();
	await page.getByRole('button', { name: /^Assets:Checking\b/ }).click();
	await expect(page).toHaveURL(/\/tx$/);
	const amount = page.getByTitle('Amount', { exact: true }).first();
	const currency = page.getByTitle('Currency', { exact: true }).first();
	await currency.fill('EUR');
	await amount.fill('5');
	await page.getByTitle('Open calculator').first().click();
	await expect(result(page)).toHaveText('5');
	await keys(page, '2', '0', '0', '-', 'Apply amount');
	await expect(page).toHaveURL(/\/calculator$/);
	await expect(result(page)).toHaveText('Error');
	await keys(page, 'Insert account balance');
	await expect(picker(page).getByRole('searchbox')).toHaveCount(0);
	await expect(picker(page)).toContainText('Assets:Checking');
	await keys(page, '198.28 EUR', '=');
	await expect(result(page)).toHaveText('1.72');
	await keys(page, 'Apply amount');
	await expect(page).toHaveURL(/\/tx$/);
	await expect(amount).toHaveValue('1.72');
	await expect(currency).toHaveValue('EUR');
	await expect(page.getByTitle('Account', { exact: true }).first()).toHaveValue('Assets:Checking');
	const saved = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		return (await (await root.getFileHandle('cashier.bean')).getFile()).text();
	});
	expect(saved).toBe(journal);
});

test('the second posting keeps the exact prefill and receives the exact displayed decimal', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'New transaction' }).click();
	await expect(page).toHaveURL(/\/tx$/);
	const amounts = page.getByTitle('Amount', { exact: true });
	const prefill = '0.123456789012345678';
	await amounts.first().fill('2');
	await amounts.nth(1).fill(prefill);
	await page.getByTitle('Open calculator').nth(1).click();
	await expect(result(page)).toHaveText(prefill);
	await keys(page, '+', '0', '=');
	await expect(result(page)).toHaveText(prefill);
	await keys(page, '1', '÷', '3', '=');
	const quotient = '0.33333333333333333333';
	await expect(result(page)).toHaveText(quotient);
	await keys(page, 'Apply amount');
	await expect(page).toHaveURL(/\/tx$/);
	await expect(amounts.first()).toHaveValue('2');
	await expect(amounts.nth(1)).toHaveValue(quotient);
});

test('applying an untouched calculator amount keeps the journal byte-for-byte unchanged', async ({
	page
}) => {
	const source = `${journal}
2025-02-01 * "Cafe" "Keep written precision"
  Assets:Checking -12.30 USD
  Equity:Opening 12.30 USD
`;
	await seedBook(page, source);
	await page.goto('/journal');
	await page.getByText('; Keep written precision', { exact: true }).click();
	await keys(page, 'Edit');
	const amount = page.getByTitle('Amount', { exact: true }).nth(1);
	await expect(amount).toHaveValue('12.30');
	await page.getByTitle('Open calculator').nth(1).click();
	await expect(result(page)).toHaveText('12.30');
	await keys(page, 'Apply amount');
	await expect(amount).toHaveValue('12.30');
	await keys(page, 'Save');
	await expect(page).toHaveURL(/\/xact-actions$/);
	const saved = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		return (await (await root.getFileHandle('cashier.bean')).getFile()).text();
	});
	expect(saved).toBe(source);
});

for (const [input, expected] of [
	['.50', '0.50'],
	['-.50', '-0.50'],
	['+.50', '+0.50']
]) {
	test(`applying ${input} from an existing posting keeps the journal readable`, async ({
		page
	}) => {
		const note = 'Leading zero for Beancount';
		await seedBook(
			page,
			journal +
				`
2025-02-01 * "Cafe" "${note}"
  Assets:Checking
  Equity:Opening 0.50 USD
`
		);
		await page.goto('/journal');
		await page.getByText(`; ${note}`, { exact: true }).click();
		await keys(page, 'Edit');
		const amount = page.getByTitle('Amount', { exact: true }).nth(1);
		await amount.fill(input);
		await page.getByTitle('Open calculator').nth(1).click();
		await expect(result(page)).toHaveText(input);
		await keys(page, 'Apply amount');
		await expect(amount).toHaveValue(expected);
		await keys(page, 'Save');
		await expect(page).toHaveURL(/\/xact-actions$/);
		const saved = await page.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			return (await (await root.getFileHandle('cashier.bean')).getFile()).text();
		});
		expect(saved).toContain(`  Equity:Opening ${expected} USD`);
		await page.goto('/journal');
		await expect(page.getByText(`; ${note}`, { exact: true })).toBeVisible();
	});
}

test('Current Balance increments by a cent with Arrow Up', async ({ page }) => {
	await seedBook(page);
	await page.goto('/accounts/bal-adj?account=Assets:Checking');
	const current = page.getByLabel('Current Balance');
	await expect(current).toHaveValue('198.28');
	await current.press('ArrowUp');
	await expect(current).toHaveValue('198.29');
	await expect(page.getByText('+0.01', { exact: false })).toBeVisible();
});

for (const [baseline, target] of [
	['1', '1.000000000000000001'],
	['1.000000000000000001', '1.000000000000000002']
]) {
	test(`balance adjustment from ${baseline} ETH retains a difference of one wei`, async ({
		page
	}) => {
		const delta = '0.000000000000000001';
		await seedBook(
			page,
			`option "operating_currency" "ETH"
2000-01-01 open Assets:Wallet ETH
2000-01-01 open Equity:Opening ETH
2000-01-01 open Expenses:Adjustment ETH
2025-01-01 * "Opening"
  Assets:Wallet ${baseline} ETH
  Equity:Opening -${baseline} ETH
`
		);
		await page.goto('/accounts/bal-adj?account=Assets:Wallet');
		const current = page.getByLabel('Current Balance');
		await expect(current).toHaveValue(baseline);
		await page.getByLabel('Expense Account').click();
		await page.getByRole('button', { name: /^Expenses:Adjustment\b/ }).click();
		await page.getByTitle('Open calculator').click();
		await expect(result(page)).toHaveText(baseline);
		await keys(page, '+', ...delta, '=', 'Apply amount');
		await expect(current).toHaveValue(target);
		await expect(page.getByText(`+${delta}`, { exact: false })).toBeVisible();
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/tx$/);
		const amounts = page.getByTitle('Amount', { exact: true });
		await expect(amounts.first()).toHaveValue(`-${delta}`);
		await expect(amounts.nth(1)).toHaveValue(delta);
		await keys(page, 'Save');
		await expect(page).toHaveURL(/\/accounts\/bal-adj/);
		const saved = await page.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			return (await (await root.getFileHandle('cashier.bean')).getFile()).text();
		});
		expect(saved).toContain(`Expenses:Adjustment  -${delta} ETH`);
		expect(saved).toContain(`Assets:Wallet  ${delta} ETH`);
	});
}

test('a book with a missing include shows diagnostics in the account chooser', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('button', { name: 'New transaction' })).toBeVisible();
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const file = await root.getFileHandle('cashier.bean', { create: true });
		const writer = await file.createWritable();
		await writer.write('include "missing.bean"\n');
		await writer.close();
	});
	await page.goto('/calculator');
	await keys(page, 'Insert account balance');
	await expect(picker(page).getByRole('alert')).toContainText('missing.bean');
	await expect(picker(page)).not.toContainText('No accounts in the local book');
	await keys(page, 'Cancel', '+/-', '(', '2', '+', '3', ')', '=');
	await expect(result(page)).toHaveText('-5');
});
