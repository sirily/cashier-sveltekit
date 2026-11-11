import { expect, test, type Page } from '@playwright/test';

const accounts = `option "operating_currency" "USD"
2000-01-01 open Assets:GBP GBP
2000-01-01 open Assets:USD USD
2000-01-01 open Expenses:Travel USD
`;

async function readJournal(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		return (await (await root.getFileHandle('cashier.bean')).getFile()).text();
	});
}

async function seed(page: Page, journal = accounts) {
	const errors: string[] = [];
	const apiRequests: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
	});
	await page.addLocatorHandler(
		page.locator('.toast').filter({ hasText: 'App ready to work offline' }),
		async (toast) =>
			toast.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click')
	);
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(async (source) => {
		const root = await navigator.storage.getDirectory();
		const file = await root.getFileHandle('cashier.bean', { create: true });
		const writer = await file.createWritable();
		await writer.write(source);
		await writer.close();
	}, journal);
	await expect
		.poll(() =>
			page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)
		)
		.toBe('activated');
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true);
	await page.getByRole('link', { name: 'Journal', exact: true }).click();
	return { errors, apiRequests };
}

async function selectAccount(page: Page, row: number, account: string, currency: string) {
	await page.getByTitle('Account', { exact: true }).nth(row).click();
	await page.getByText(account, { exact: true }).click();
	await expect(page.getByTitle('Account', { exact: true }).nth(row)).toHaveValue(account);
	// Currency is an ordinary commodity code, never a place to inject @@ syntax.
	await page.getByTitle('Currency', { exact: true }).nth(row).fill(currency);
}

async function expectBalancedAndValidate(page: Page, currency = 'USD') {
	await expect(page.getByText('unbalanced', { exact: true })).toHaveCount(0);
	const rate = page.getByLabel('Exchange rate');
	if (await rate.count()) {
		await expect(rate).toHaveCount(1);
		await expect(rate).toContainText(new RegExp(`^1 [A-Z]+ = [\\d.]+ ${currency}$`));
		await expect(rate.locator('..')).toContainText('Postings');
		await expect(page.getByLabel('Weighted residual')).toHaveCount(0);
	} else {
		await expect(page.getByLabel('Weighted residual')).toContainText(`0 ${currency}`);
		await expect(page.getByLabel('Weighted residual').locator('data')).toHaveCount(1);
	}
	await page.locator('.navbar .dropdown > button').click();
	await page.getByText('Validate', { exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Transaction is valid — no issues found');
	await expect(dialog).not.toContainText(/don't balance|NaN|Infinity/);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

async function reopen(page: Page, note: string) {
	await page.getByText(note, { exact: false }).click();
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByTitle('Note', { exact: true })).toHaveValue(note);
}

function expectOneExchange(
	source: string,
	flag: string,
	spent: string,
	received: string,
	destination: string
) {
	expect(source.match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(1);
	expect(source).toMatch(new RegExp(`^\\d{4}-\\d{2}-\\d{2} \\${flag} `, 'm'));
	expect(source).toContain(`Assets:GBP  ${spent} GBP @@ ${received} USD`);
	expect(source).toContain(`${destination}  ${received} USD`);
	expect(source.match(/@@/g)).toHaveLength(1);
	expect(source.match(/^\s+(?:Assets|Expenses|Equity|Income|Liabilities):/gm)).toHaveLength(2);
	expect(source).not.toMatch(/(?<!@)@(?!@)/);
}

test('sign changes preserve trailing decimals and reverse the inferred exchange direction', async ({
	page
}) => {
	const evidence = await seed(page);
	await page.locator('button.fixed').click();
	await selectAccount(page, 0, 'Assets:GBP', 'GBP');
	await selectAccount(page, 1, 'Assets:USD', 'USD');
	await page.getByTitle('Note', { exact: true }).fill('Sign-preserving exchange');
	const spent = page.getByTitle('Amount', { exact: true }).nth(0);
	const received = page.getByTitle('Amount', { exact: true }).nth(1);
	await spent.fill('-10.00');
	await received.fill('12.30');
	await page.getByTitle('Mark as complete', { exact: true }).click();
	const spentSign = spent.locator('..').getByRole('button').first();
	const receivedSign = received.locator('..').getByRole('button').first();
	await spentSign.click();
	await expect(spent).toHaveValue('10.00');
	await expect(received).toHaveValue('12.30');
	await expect(page.locator('main')).not.toContainText('1 GBP = 1.23 USD');
	await receivedSign.click();
	await expect(received).toHaveValue('-12.30');
	await expect(page.locator('main')).toContainText(/1 USD = [\d.]+ GBP/);
	await expectBalancedAndValidate(page, 'GBP');
	await spentSign.click();
	await receivedSign.click();
	await expect(spent).toHaveValue('-10.00');
	await expect(received).toHaveValue('12.30');
	await expect(page.locator('main')).toContainText('1 GBP = 1.23 USD');
	await expectBalancedAndValidate(page);
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/journal$/);
	expectOneExchange(await readJournal(page), '*', '-10.00', '12.30', 'Assets:USD');
	expect(evidence.errors).toEqual([]);
	expect(evidence.apiRequests).toEqual([]);
});

test('account selection preserves entered decimals and calculator replaces stale amount text', async ({
	page
}) => {
	const evidence = await seed(page);
	await page.locator('button.fixed').click();
	await selectAccount(page, 0, 'Assets:GBP', 'GBP');
	await selectAccount(page, 1, 'Assets:USD', 'USD');
	await page.getByTitle('Note', { exact: true }).fill('Calculator exchange');
	await page.getByTitle('Amount', { exact: true }).nth(0).fill('-10.00');
	await page.getByTitle('Amount', { exact: true }).nth(1).fill('12.30');
	await page.getByTitle('Mark as complete', { exact: true }).click();
	await selectAccount(page, 1, 'Expenses:Travel', 'USD');
	await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-10.00');
	await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue('12.30');
	await expect(page.locator('main')).toContainText('1 GBP = 1.23 USD');
	await selectAccount(page, 1, 'Assets:USD', 'USD');
	await page.getByTitle('Open calculator', { exact: true }).nth(1).click();
	await expect(page).toHaveURL(/\/calculator$/);
	for (const key of ['AC', '1', '3', '.', '2', '=']) {
		await page.getByRole('button', { name: key, exact: true }).click();
	}
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/tx$/);
	await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-10.00');
	await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue('13.2');
	await expect(page.locator('main')).toContainText('1 GBP = 1.32 USD');
	await expectBalancedAndValidate(page);
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/journal$/);
	const saved = await readJournal(page);
	expectOneExchange(saved, '*', '-10.00', '13.2', 'Assets:USD');
	expect(saved).not.toContain('12.30');
	await reopen(page, 'Calculator exchange');
	await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-10.00');
	await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue('13.2');
	expect(evidence.errors).toEqual([]);
	expect(evidence.apiRequests).toEqual([]);
});

test('remembered total-price transaction retains exact decimals and price kind across reload and reuse', async ({
	page
}) => {
	const original = `2025-01-02 * "Exchange" "Remember original"
  cashier_id: "remember-original-id"
  Assets:GBP  -10.00 GBP @@ 12.30 USD
  Assets:USD  12.30 USD
`;
	const evidence = await seed(page, accounts + original);
	await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('settings', 'readwrite');
				tx.objectStore('settings').put({ key: 'rememberLastTransaction', value: 'true' });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	});
	// Reload settings before using the real save path to populate lastXact.
	await page.reload();
	await expect(page).toHaveURL(/\/journal$/);
	await reopen(page, 'Remember original');
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/xact-actions$/);
	expect(await readJournal(page)).toBe(accounts + original);
	const remembered = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise<{
				transaction: {
					postings: Array<{
						account: string;
						amountText: string;
						currency: string;
						price?: { kind: string; amount: string; currency: string };
					}>;
				};
			}>((resolve, reject) => {
				const request = db
					.transaction('lastXact', 'readonly')
					.objectStore('lastXact')
					.get('Exchange');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
		} finally {
			db.close();
		}
	});
	expect(remembered.transaction.postings).toMatchObject([
		{
			account: 'Assets:GBP',
			amountText: '-10.00',
			currency: 'GBP',
			price: { kind: 'total', amount: '12.30', currency: 'USD' }
		},
		{ account: 'Assets:USD', amountText: '12.30', currency: 'USD' }
	]);
	await page.getByRole('link', { name: 'Journal', exact: true }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await page.reload();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByText('Remember original', { exact: false })).toBeVisible();
	await page.locator('button.fixed').click();
	await page.getByTitle('Payee', { exact: true }).click();
	await page
		.getByRole('listitem')
		.filter({ hasText: /^Exchange$/ })
		.click();
	await expect(page).toHaveURL(/\/tx$/);
	await expect(page.getByTitle('Account', { exact: true }).nth(0)).toHaveValue('Assets:GBP');
	await expect(page.getByTitle('Account', { exact: true }).nth(1)).toHaveValue('Assets:USD');
	await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-10.00');
	await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue('12.30');
	await expect(page.locator('main')).toContainText('1 GBP = 1.23 USD');
	await expectBalancedAndValidate(page);
	await page.getByTitle('Note', { exact: true }).fill('Remember reused');
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/journal$/);
	const saved = await readJournal(page);
	expect(saved.startsWith(accounts + original)).toBe(true);
	expect(saved.match(/cashier_id: "remember-original-id"/g)).toHaveLength(1);
	expect(saved.match(/"Remember reused"/g)).toHaveLength(1);
	expect(saved.match(/Assets:GBP  -10\.00 GBP @@ 12\.30 USD/g)).toHaveLength(2);
	expect(saved.match(/Assets:USD  12\.30 USD/g)).toHaveLength(2);
	expect(evidence.errors).toEqual([]);
	expect(evidence.apiRequests).toEqual([]);
});

for (const flag of ['*', '!']) {
	for (const destination of ['Assets:USD', 'Expenses:Travel']) {
		test(`ordinary ${destination} exchange ${flag}: offline create, reload and reopen with exact total price`, async ({
			page,
			context
		}) => {
			const evidence = await seed(page);
			await page.locator('button.fixed').click();
			await expect(page).toHaveURL(/\/tx$/);
			await expect(page.getByTitle('Account', { exact: true })).toHaveCount(2);
			await selectAccount(page, 0, 'Assets:GBP', 'GBP');
			await selectAccount(page, 1, destination, 'USD');
			await page.getByTitle('Note', { exact: true }).fill('Ordinary exchange');
			await page.getByTitle('Amount', { exact: true }).nth(0).fill('-10');
			await page.getByTitle('Amount', { exact: true }).nth(1).fill('12.30');
			await page
				.getByTitle(flag === '*' ? 'Mark as complete' : 'Mark as incomplete / needs review', {
					exact: true
				})
				.click();
			await expect(page.locator('main')).toContainText('1 GBP = 1.23 USD');
			await expectBalancedAndValidate(page);

			await context.setOffline(true);
			await page.locator('button.fixed').click();
			await expect(page).toHaveURL(/\/journal$/);
			const saved = await readJournal(page);
			expectOneExchange(saved, flag, '-10', '12.30', destination);
			await page.reload();
			await expect(page.locator('main')).toContainText('Ordinary exchange');
			await reopen(page, 'Ordinary exchange');
			await expect(page.getByTitle('Account', { exact: true }).nth(0)).toHaveValue('Assets:GBP');
			await expect(page.getByTitle('Account', { exact: true }).nth(1)).toHaveValue(destination);
			await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-10');
			await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue(/^12\.30?$/);
			await expect(page.getByTitle('Currency', { exact: true }).nth(0)).toHaveValue('GBP');
			await expect(page.getByTitle('Currency', { exact: true }).nth(1)).toHaveValue('USD');
			await expect(
				page.getByTitle(flag === '*' ? 'Mark as complete' : 'Mark as incomplete / needs review', {
					exact: true
				})
			).toHaveClass(flag === '*' ? /btn-success/ : /btn-warning/);
			await expect(page.locator('main')).toContainText('1 GBP = 1.23 USD');
			await expectBalancedAndValidate(page);
			await page.locator('button.fixed').click();
			await expect(page).toHaveURL(/\/xact-actions$/);
			expect(await readJournal(page)).toBe(saved);
			expect(evidence.errors).toEqual([]);
			expect(evidence.apiRequests).toEqual([]);
		});
	}

	test(`total-price ${flag} corrections preserve source and identity across immediate consecutive edits`, async ({
		page,
		context
	}) => {
		const original = `2025-01-02 ${flag} "Exchange" "Preserved exchange" #travel ^receipt-31 ; header comment
  cashier_id: "exchange-edit-id"
  receipt: "original.pdf"
  ; transaction comment
  Assets:GBP  -10 GBP @@ 12.30 USD ; spent comment
    reference: "GBP reference"
  Assets:USD  12.30 USD ; received comment
    reference: "USD reference"
`;
		const neighbor = `\n2025-01-03 ! "Neighbor" "Unchanged neighbor"
  cashier_id: "neighbor-id"
  Assets:GBP  -1 GBP
  Assets:GBP  1 GBP
`;
		const evidence = await seed(page, accounts + original + neighbor);
		await reopen(page, 'Preserved exchange');
		await context.setOffline(true);
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		expect(await readJournal(page)).toBe(accounts + original + neighbor);

		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await page.getByTitle('Amount', { exact: true }).nth(0).fill('-11');
		await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue(/^12\.30?$/);
		await expect(page.locator('main')).not.toContainText('1 GBP = 1.23 USD');
		await expectBalancedAndValidate(page);
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		const first = original.replace('-10 GBP', '-11 GBP');
		expect(await readJournal(page)).toBe(accounts + first + neighbor);

		// No reload/navigation reset between saves: exercise the updated DirectiveSpan (#29).
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-11');
		await page.getByTitle('Amount', { exact: true }).nth(1).fill('13.20');
		await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-11');
		await expect(page.locator('main')).toContainText(/1 GBP = 1\.2(?:0+)? USD/);
		await expectBalancedAndValidate(page);
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		const corrected = first.replaceAll('12.30 USD', '13.20 USD');
		expect(await readJournal(page)).toBe(accounts + corrected + neighbor);

		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await page.getByTitle('Note', { exact: true }).fill('Corrected exchange');
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		const expected =
			accounts + corrected.replace('"Preserved exchange"', '"Corrected exchange"') + neighbor;
		expect(await readJournal(page)).toBe(expected);
		expect(expected.match(/cashier_id: "exchange-edit-id"/g)).toHaveLength(1);
		expect(expected.match(/"Corrected exchange"/g)).toHaveLength(1);
		await page.getByRole('link', { name: 'Journal', exact: true }).click();
		// A client-side link click can return before SvelteKit commits its navigation.
		await expect(page).toHaveURL(/\/journal$/);
		await page.reload();
		await expect(page).toHaveURL(/\/journal$/);
		await reopen(page, 'Corrected exchange');
		await expect(page.getByTitle('Amount', { exact: true }).nth(0)).toHaveValue('-11');
		await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue(/^13\.20?$/);
		expect(await readJournal(page)).toBe(expected);
		expect(evidence.errors).toEqual([]);
		expect(evidence.apiRequests).toEqual([]);
	});
}

for (const [spent, received] of [
	['-3', '10'],
	['-0.123456789012345678', '12.300000000000000001']
]) {
	test(`ordinary exchange preserves exact decimals ${spent}/${received}, not a rounded rate product`, async ({
		page
	}) => {
		await seed(page);
		await page.locator('button.fixed').click();
		await selectAccount(page, 0, 'Assets:GBP', 'GBP');
		await selectAccount(page, 1, 'Assets:USD', 'USD');
		await page.getByTitle('Note', { exact: true }).fill('Precise exchange');
		await page.getByTitle('Amount', { exact: true }).nth(0).fill(spent);
		await page.getByTitle('Amount', { exact: true }).nth(1).fill(received);
		await page.getByTitle('Mark as complete', { exact: true }).click();
		await expectBalancedAndValidate(page);
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/journal$/);
		expectOneExchange(await readJournal(page), '*', spent, received, 'Assets:USD');
	});
}

test('ordinary same-currency capture stays unpriced and validates unchanged', async ({ page }) => {
	await seed(page);
	await page.locator('button.fixed').click();
	await selectAccount(page, 0, 'Assets:USD', 'USD');
	await selectAccount(page, 1, 'Expenses:Travel', 'USD');
	await page.getByTitle('Note', { exact: true }).fill('Same currency');
	await page.getByTitle('Amount', { exact: true }).nth(0).fill('-10');
	await page.getByTitle('Amount', { exact: true }).nth(1).fill('10');
	await page.getByTitle('Mark as complete', { exact: true }).click();
	await expectBalancedAndValidate(page);
	await expect(page.locator('main')).not.toContainText(/1 USD =/);
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/journal$/);
	const source = await readJournal(page);
	expect(source).toContain('Assets:USD  -10 USD');
	expect(source).toContain('Expenses:Travel  10 USD');
	expect(source).not.toContain('@');
	expect(source.match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(1);
});

test('weighted residual keeps unmatched currencies separate and agrees with Validate', async ({
	page
}) => {
	await seed(
		page,
		accounts +
			`2025-01-02 ! "Unpriced split"
  Assets:GBP -10 GBP
  Assets:USD 12.30 USD
  Expenses:Travel 1 USD
`
	);
	await reopen(page, 'Unpriced split');
	const residual = page.getByLabel('Weighted residual');
	await expect(residual).toContainText('-10 GBP');
	await expect(residual).toContainText('13.3 USD');
	await expect(residual.locator('data')).toHaveCount(2);
	await expect(page.getByText('unbalanced', { exact: true })).toBeVisible();
	await page.locator('.navbar .dropdown > button').click();
	await page.getByText('Validate', { exact: true }).click();
	await expect(page.getByRole('dialog')).toContainText("Postings for GBP don't balance");
	await expect(page.getByRole('dialog')).toContainText("Postings for USD don't balance");
});

test('weighted residual distinguishes an automatic amount from a numeric remainder', async ({
	page
}) => {
	await seed(
		page,
		accounts +
			`2025-01-02 ! "Automatic amount"
  Assets:USD -10 USD
  Expenses:Travel
`
	);
	await reopen(page, 'Automatic amount');
	await expect(page.getByLabel('Weighted residual')).toContainText('Automatic balance');
	await expect(page.getByLabel('Weighted residual').locator('data')).toHaveCount(0);
	await expect(page.getByText('unbalanced', { exact: true })).toHaveCount(0);
});
