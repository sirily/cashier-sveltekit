import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/'))
			throw new Error(`Unexpected server request: ${request.method()}`);
	});
	await page.addLocatorHandler(
		page.locator('.toast').filter({ hasText: 'App ready to work offline' }),
		async (toast) => {
			await toast.getByRole('button', { name: 'Close', exact: true }).dispatchEvent('click');
		}
	);
});

const neighbor =
	'\n2025-01-04 * "Neighbor" "Untouched neighbor"\n  Expenses:Food  2 USD\n  Assets:Cash  -2 USD\n';

async function seed(page: Page) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(async (neighbor) => {
		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('cashier.bean', { create: true });
		const writer = await handle.createWritable();
		await writer.write(
			'2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n2025-01-01 * "Cafe" "Original note"\n  cashier_id: "qa-edit-id"\n  Expenses:Food  10 USD\n  Assets:Cash  -10 USD\n' +
				neighbor
		);
		await writer.close();
	}, neighbor);
	await page.reload();
	await page.getByRole('link', { name: 'Journal', exact: true }).click();
	await page.getByText('Original note', { exact: false }).click();
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByTitle('Note', { exact: true })).toHaveValue('Original note');
}
for (const route of ['delete', 'reorder']) {
	test(`D1 saved editor returns from ${route} without client errors`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (error) => {
			errors.push(error.message);
			console.log('CLIENT ERROR', error.stack);
		});
		page.on('console', (message) => {
			if (message.type() === 'error') errors.push(message.text());
		});
		await seed(page);
		await page.getByTitle('Note', { exact: true }).fill('Unsaved note');
		await page.locator(`a[href="/postings/${route}"]`).click();
		if (route === 'delete') {
			await page.locator('article button').first().click();
			await page.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(page.locator('article button')).toHaveCount(2);
			await page.locator('article button').first().click();
			await page.getByRole('button', { name: 'OK', exact: true }).click();
		}
		await page.locator('button.fixed').click();
		await expect(page.getByTitle('Note', { exact: true }), errors.join('\n')).toHaveValue(
			'Unsaved note'
		);
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page.getByTitle('Note', { exact: true })).toHaveValue('Unsaved note');
		await expect(page.getByTitle('Account', { exact: true })).toHaveCount(
			route === 'delete' ? 1 : 2
		);
		const source = await readJournal(page);
		expect(source.match(/cashier_id: "qa-edit-id"/g)).toHaveLength(1);
		expect(source.match(/^2025-01-01 /gm)).toHaveLength(1);
		expect(source.endsWith(neighbor)).toBe(true);
		expect(errors).toEqual([]);
	});
}

async function readJournal(page: Page) {
	return page.evaluate(async () =>
		(
			await (await (await navigator.storage.getDirectory()).getFileHandle('cashier.bean')).getFile()
		).text()
	);
}

test('D1 production pointer reorder survives return and save/reopen', async ({ page }) => {
	await seed(page);
	await page.locator('a[href="/postings/reorder"]').click();
	const handle = page.getByRole('button', { name: 'Drag to reorder' }).first();
	const start = (await handle.boundingBox())!;
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 52, { steps: 10 });
	await page.mouse.up();
	await expect(page.locator('[data-item]').first()).toContainText('Assets:Cash');
	await page.locator('button.fixed').click();
	await expect(page.getByTitle('Account', { exact: true }).first()).toHaveValue('Assets:Cash');
	await page.locator('button.fixed').click();
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByTitle('Account', { exact: true }).first()).toHaveValue('Assets:Cash');
	expect(await readJournal(page)).toContain('qa-edit-id');
});

test('D6 About and Help explain the fork and retain controls', async ({ page }) => {
	await page.goto('/about');
	await expect(page.locator('main')).toContainText('Python Beancount');
	await expect(page.locator('main')).toContainText('RustLedger');
	await expect(page.locator('main')).not.toContainText('Ledger Import');
	await expect(page.getByRole('link', { name: 'GitHub' })).toHaveAttribute(
		'href',
		'https://github.com/sirily/cashier-sveltekit'
	);
	await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Parsed Ledger', exact: true })).toHaveAttribute(
		'href',
		'/ledger'
	);
	await expect(page.getByRole('link', { name: 'Parsed Multi Ledger' })).toHaveAttribute(
		'href',
		'/ledger/multi'
	);
	await page.getByRole('link', { name: 'Help', exact: true }).last().click();
	await expect(page.locator('main')).toContainText('including while offline');
	await expect(page.locator('main a[href*=cashier-book]')).toHaveCount(0);
	await expect(page.locator('main a[href="/sync"]')).toBeVisible();
});

for (const currencyInput of ['USD', 'USD ', 'usd', '/USD', '/NQH21']) {
	const commodity = currencyInput.startsWith('/') ? currencyInput : 'USD';
	test(`D2 real WASM canonical ${JSON.stringify(currencyInput)} adjustment saves +3.19 ${commodity}`, async ({
		page
	}) => {
		await seed(page);
		const original = await readJournal(page);
		await page.evaluate(async (commodity) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const r = indexedDB.open('Cashier');
				r.onsuccess = () => resolve(r.result);
				r.onerror = () => reject(r.error);
			});
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('settings', 'readwrite');
				tx.objectStore('settings').put({
					key: 'userBookFilename',
					value: JSON.stringify('book.bean')
				});
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
			db.close();
			const root = await navigator.storage.getDirectory();
			const file = await root.getFileHandle('book.bean', { create: true });
			const writer = await file.createWritable();
			await writer.write(
				`2000-01-01 open Assets:Wallet GBP,${commodity}\n2000-01-01 open Equity:Opening GBP,${commodity}\n2000-01-01 open Expenses:Adjustment GBP,${commodity}\n2025-01-01 * "Opening"\n  Assets:Wallet  290 GBP\n  Equity:Opening  -290 GBP\n2025-01-02 * "Opening USD"\n  Assets:Wallet  66.81 ${commodity}\n  Equity:Opening  -66.81 ${commodity}\n`
			);
			await writer.close();
		}, commodity);
		await page.goto('/accounts/bal-adj?account=Assets:Wallet');
		await expect(page.getByLabel('Current Balance')).toHaveValue(
			commodity.startsWith('/') ? '66.81' : '290'
		);
		await page.getByPlaceholder('EUR').fill(currencyInput);
		await page.getByLabel('Current Balance').fill('70');
		await expect(page.locator('main')).toContainText('+3.19');
		await expect(page.locator('main')).toContainText('66.81');
		await page.getByPlaceholder('EUR').fill('GBP');
		await expect(page.locator('main')).toContainText('-220.00');
		await page.getByPlaceholder('EUR').fill(currencyInput);
		await page.getByLabel('Expense Account').click();
		await page.getByText('Expenses:Adjustment', { exact: true }).click();
		await expect(page.getByLabel('Current Balance')).toHaveValue('70');
		await expect(page.locator('main')).toContainText('+3.19');
		await page.locator('button.fixed').click();
		await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue('3.19');
		await page.locator('button.fixed').click();
		await expect.poll(() => readJournal(page)).toContain('Assets:Wallet');
		const saved = await readJournal(page);
		expect(saved.startsWith(original)).toBe(true);
		expect(saved).toContain('3.19 ' + commodity);
		expect(saved).toContain('-3.19 ' + commodity);
		await page.goto('/journal');
		await page.getByText('Balance Adjustment', { exact: false }).click();
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page.getByTitle('Amount', { exact: true }).nth(1)).toHaveValue('3.19');
		await page.goto('/accounts/bal-adj?account=Assets:Wallet');
		await expect(page.getByLabel('Current Balance')).toHaveValue(
			commodity.startsWith('/') ? '70' : '290'
		);
		await page.getByPlaceholder('EUR').fill(currencyInput);
		await page.getByLabel('Current Balance').fill('70');
		await expect(page.locator('main')).not.toContainText('+70.00');
		await expect(page.locator('main')).not.toContainText('+3.19');
		await expect(page.locator('main')).toContainText('70 ' + commodity);
	});
}

for (const route of ['delete', 'reorder']) {
	test(`D1 new draft survives ${route} return and save/reopen`, async ({ page }) => {
		await page.goto('/journal');
		await expect(page.getByText('The device journal is empty')).toBeVisible();
		await page.locator('button.fixed').click();
		await page.getByTitle('Note', { exact: true }).fill('New subpage draft');
		await page.locator(`a[href="/postings/${route}"]`).click();
		if (route === 'delete') {
			await page.locator('article button').first().click();
			await page.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(page.locator('article button')).toHaveCount(2);
			await page.locator('article button').first().click();
			await page.getByRole('button', { name: 'OK', exact: true }).click();
		}
		await page.locator('button.fixed').click();
		await expect(page.getByTitle('Note', { exact: true })).toHaveValue('New subpage draft');
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/journal$/);
		await page.getByText('New subpage draft', { exact: false }).click();
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page.getByTitle('Note', { exact: true })).toHaveValue('New subpage draft');
		expect((await readJournal(page)).match(/New subpage draft/g)).toHaveLength(1);
	});
}

type Tuple = [string, string, string];
async function expectEditor(page: Page, tuples: Tuple[]) {
	await expect(page.getByTitle('Date', { exact: true })).toHaveValue('2025-02-03');
	await expect(page.getByTitle('Payee', { exact: true })).toHaveValue('Neighbor');
	await expect(page.getByTitle('Note', { exact: true })).toHaveValue('Full-field unsaved edit');
	await expect(page.getByTitle('Mark as incomplete / needs review')).toHaveClass(/btn-warning/);
	const actual = await page
		.getByTitle('Account', { exact: true })
		.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
	expect(actual).toEqual(tuples.map((t) => t[0]));
	for (const [i, tuple] of tuples.entries()) {
		await expect(page.getByTitle('Amount', { exact: true }).nth(i)).toHaveValue(tuple[1]);
		await expect(page.getByTitle('Currency', { exact: true }).nth(i)).toHaveValue(tuple[2]);
	}
}
for (const saved of [false, true])
	for (const action of ['delete', 'noop', 'pointer']) {
		test(`D1 complete tuples and fields: saved=${saved}, ${action}`, async ({ page }) => {
			await seed(page);
			const original = await readJournal(page);
			if (!saved) {
				await page.getByRole('link', { name: 'Journal', exact: true }).click();
				await expect(page).toHaveURL(/\/journal$/);
				await page.locator('button.fixed').click();
			}
			await page.getByTitle('Account', { exact: true }).nth(0).click();
			await page.getByText('Expenses:Food', { exact: true }).click();
			await page.getByTitle('Account', { exact: true }).nth(1).click();
			await page.getByText('Assets:Cash', { exact: true }).click();
			await page
				.locator('button')
				.filter({ has: page.locator('svg.lucide-circle-plus') })
				.click();
			await page.getByTitle('Account', { exact: true }).nth(2).click();
			await page.getByText('Expenses:Food', { exact: true }).click();
			const tuples: Tuple[] = [
				['Expenses:Food', '12.5', 'USD'],
				['Assets:Cash', '-12.5', 'USD'],
				['Expenses:Food', '0', 'GBP']
			];
			for (const [i, t] of tuples.entries()) {
				await page.getByTitle('Amount', { exact: true }).nth(i).fill(t[1]);
				await page.getByTitle('Currency', { exact: true }).nth(i).fill(t[2]);
			}
			await page.getByTitle('Payee', { exact: true }).click();
			await page
				.getByRole('listitem')
				.filter({ hasText: /^Neighbor$/ })
				.click();
			await page.getByTitle('Date', { exact: true }).fill('2025-02-03', { force: true });
			await page.getByTitle('Note', { exact: true }).fill('Full-field unsaved edit');
			await page.getByTitle('Mark as incomplete / needs review').click();
			await expectEditor(page, tuples);
			const route = action === 'delete' ? 'delete' : 'reorder';
			await page.locator(`a[href="/postings/${route}"]`).click();
			if (action === 'delete') {
				await page.locator('article button').nth(2).click();
				await page.getByRole('button', { name: 'Cancel', exact: true }).click();
				await page.locator('button.fixed').click();
				await expectEditor(page, tuples);
				await page.locator('a[href="/postings/delete"]').click();
				await page.locator('article button').nth(2).click();
				await page.getByRole('button', { name: 'OK', exact: true }).click();
				tuples.pop();
			} else if (action === 'pointer') {
				const box = (await page
					.getByRole('button', { name: 'Drag to reorder' })
					.first()
					.boundingBox())!;
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
				await page.mouse.down();
				await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 104, { steps: 10 });
				await page.mouse.up();
				tuples.push(tuples.shift()!);
			}
			await page.locator('button.fixed').click();
			await expectEditor(page, tuples);
			await page.locator('button.fixed').click();
			await expect.poll(() => readJournal(page)).toContain('Full-field unsaved edit');
			const source = await readJournal(page);
			expect(source.match(/Full-field unsaved edit/g)).toHaveLength(1);
			expect(source.match(/cashier_id: "qa-edit-id"/g)).toHaveLength(1);
			if (saved) expect(source.endsWith(neighbor)).toBe(true);
			else expect(source.startsWith(original)).toBe(true);
			const entry = source.slice(source.indexOf('2025-02-03')).split(/\n(?=\d{4}-)/)[0];
			expect(entry).toContain(`2025-02-03 ! "Neighbor" "Full-field unsaved edit"`);
			const persisted = [
				...entry.matchAll(/^[ \t]+([A-Z][^ \n]+)\s+(-?[0-9.]+) ([A-Z]+)[ \t]*$/gm)
			].map((m) => [m[1], m[2], m[3]]);
			expect(persisted).toEqual(tuples);
			await page.goto('/journal');
			await page.getByText('Full-field unsaved edit', { exact: false }).click();
			await page.getByRole('button', { name: 'Edit', exact: true }).click();
			await expectEditor(page, tuples);
		});
	}

test('D2 absent /6J cannot hand off a parser-corrupted adjustment or change journal', async ({
	page
}) => {
	await seed(page);
	const original = await readJournal(page);
	await page.goto('/accounts/bal-adj?account=Assets:Cash');
	await expect(page.getByLabel('Current Balance')).toHaveValue('-12');
	await page.getByPlaceholder('EUR').fill('/6J');
	await page.getByLabel('Current Balance').fill('70');
	await page.getByLabel('Expense Account').click();
	await page.getByText('Expenses:Food', { exact: true }).click();
	await expect(page.locator('main')).toContainText('+70.00');
	await page.locator('button.fixed').click();
	await expect(page.getByRole('alert')).toContainText('local engine');
	await expect(page).toHaveURL(/\/accounts\/bal-adj/);
	await expect(page.getByLabel('Current Balance')).toHaveValue('70');
	await expect(page.getByPlaceholder('EUR')).toHaveValue('/6J');
	expect(await readJournal(page)).toBe(original);
	await page.reload();
	expect(await readJournal(page)).toBe(original);
});
