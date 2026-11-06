import { expect, test, type Page } from '@playwright/test';

const transaction = (account: string, amount: number, currency: string, description: string) =>
	`2026-10-01 * "${description}"\n  ${account} ${amount} ${currency}\n  Assets:Cash ${-amount} ${currency}\n`;
const draft = `2026-10-02 ! "Incomplete local draft"
  Expenses:Food
  Assets:Cash
`;
const files = {
	'cashier.bean': transaction('Expenses:Food', 7, 'RUB', 'Pending overlay'),
	'main.bean': `option "operating_currency" "USD"
option "operating_currency" "RUB"
2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2000-01-01 open Income:Salary
include "included.bean"
${transaction('Expenses:Food', 20, 'USD', 'Root expense')}${transaction('Income:Salary', -100, 'USD', 'Root income')}`,
	'included.bean': `2026-10-01 price RUB 2 USD
${transaction('Expenses:Food', 30, 'RUB', 'Included expense')}${transaction('Income:Salary', -40, 'RUB', 'Included income')}`,
	'unrelated.txt': 'Preserve this non-book text'
};

async function cacheMetadata(page: Page): Promise<{ sourceHash: string; binaryHash: string }> {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		return JSON.parse(
			await (await (await root.getFileHandle('ledger-cache.bin.json')).getFile()).text()
		);
	});
}

async function storedState(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const sources: Record<string, string> = {};
		for await (const [name, handle] of root.entries()) {
			if (handle.kind === 'file' && !name.startsWith('ledger-cache.bin'))
				sources[name] = await (await (handle as FileSystemFileHandle).getFile()).text();
		}
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const settings = await new Promise<unknown[]>((resolve, reject) => {
				const request = db.transaction('settings').objectStore('settings').getAll();
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return { sources, settings };
		} finally {
			db.close();
		}
	});
}
async function navigate(page: Page, name: string) {
	const link = page.locator('aside').getByRole('link', { name, exact: true, includeHidden: true });
	const details = link.locator('xpath=ancestor::details');
	if (await details.count()) {
		if (!(await details.evaluate((e) => (e as HTMLDetailsElement).open)))
			await details.locator('summary').click();
		// Expansion can move the link between pointer-down and pointer-up after auto-scrolling.
		await details.evaluate(async (element) => {
			await Promise.all(
				element.getAnimations({ subtree: true }).map((animation) => animation.finished)
			);
		});
	}
	const destinations: Record<string, string> = {
		Reports: '/reports',
		'File Storage': '/opfs',
		Journal: '/journal'
	};
	await link.click();
	await expect(page).toHaveURL(destinations[name]);
}
async function report(page: Page) {
	await navigate(page, 'Reports');
	await page.getByRole('link', { name: 'Income vs Expenses', exact: true }).click();
	await expect(page).toHaveURL(/\/reports\/income-expense$/);
}
async function expectReport(page: Page, income: number, expenses: number) {
	await expect(page.locator('canvas')).toBeVisible();
	await expect(page.getByRole('status')).toHaveCount(0);
	await expect(page.getByRole('button', { name: /^Income \(/ })).toContainText(`${income}.00 USD`);
	await expect(page.getByRole('button', { name: /^Expenses \(/ })).toContainText(
		`${expenses}.00 USD`
	);
}
async function expectDiagnostics(page: Page, message: string, absent?: string) {
	const status = page.getByRole('status');
	await expect(status).toContainText('Report incomplete');
	await status.locator('summary').click();
	await expect(status).toContainText(message);
	if (absent) await expect(status).not.toContainText(absent);
	await expect(page.locator('canvas')).toHaveCount(0);
}
async function edit(page: Page, path: string, content: string) {
	await navigate(page, 'File Storage');
	await expect(page.locator('.navbar').getByText('OPFS Files', { exact: true })).toBeVisible();
	await page.getByRole('cell').getByText(path, { exact: true }).click();
	await expect(page.locator('textarea')).toBeVisible();
	await page.locator('textarea').fill(content);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	await expect(page.getByText('*Unsaved changes', { exact: true })).toHaveCount(0);
	await expect(page.getByText('File saved successfully', { exact: true })).toBeVisible();
}
async function expectPostings(
	page: Page,
	root = 20,
	included = 30,
	overlay = true,
	invalid = false,
	rootIncome = 100,
	includedIncome = 40
) {
	await navigate(page, 'Reports');
	await page.getByRole('link', { name: 'Queries', exact: true }).click();
	await page
		.locator('textarea')
		.fill(
			'SELECT number, currency, description WHERE account ~ "^(Expenses|Income)" ORDER BY description'
		);
	await page.getByRole('button', { name: 'Query', exact: true }).click();
	const rows = page.locator('tbody tr');
	await expect(rows).toHaveCount(4 + Number(overlay) + Number(invalid));
	for (const [description, number, currency] of [
		['Root expense', String(root), 'USD'],
		['Root income', String(-rootIncome), 'USD'],
		['Included expense', String(included), 'RUB'],
		['Included income', String(-includedIncome), 'RUB'],
		...(overlay ? [['Pending overlay', '7', 'RUB']] : [])
	]) {
		const row = rows.filter({ hasText: description });
		await expect(row.locator('td').nth(0)).toHaveText(number);
		await expect(row.locator('td').nth(1)).toHaveText(currency);
	}
	await expect(rows.filter({ hasText: 'Incomplete local draft' })).toHaveCount(0);
	if (!overlay) await expect(rows.filter({ hasText: 'Pending overlay' })).toHaveCount(0);
	if (invalid) await expect(rows.filter({ hasText: 'Genuine book error' })).toHaveCount(1);
	// Actual account balances, not only report summaries, must retain original currencies.
	if (!invalid) {
		await page
			.locator('textarea')
			.fill(
				'SELECT currency, sum(number) WHERE account = "Assets:Cash" GROUP BY currency ORDER BY currency'
			);
		await page.getByRole('button', { name: 'Query', exact: true }).click();
		await expect(rows).toHaveCount(2);
		await expect(rows.filter({ hasText: 'USD' }).locator('td').nth(1)).toHaveText(
			String(rootIncome - root)
		);
		await expect(rows.filter({ hasText: 'RUB' }).locator('td').nth(1)).toHaveText(
			String(includedIncome - included - (overlay ? 7 : 0))
		);
	}
}
async function seed(page: Page) {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(async (sources) => {
		const root = await navigator.storage.getDirectory();
		for (const [name, content] of Object.entries(sources)) {
			const writer = await (await root.getFileHandle(name, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
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
					ledgerCacheEnabled: true,
					currency: 'USD',
					syncApiToken: 'opfs-preserved-token',
					syncServerUrl: 'https://opfs.invalid'
				}))
					tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	}, files);
	// Fixture setup only: subsequent saves must refresh without validation or cache toggles.
	await page.goto('/util/validation');
	await page.getByRole('button', { name: 'Reload & Validate', exact: true }).click();
	await expect(page.getByText('Valid', { exact: true })).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				return (await (await root.getFileHandle('ledger-cache.bin.json')).getFile()).size;
			})
		)
		.toBeGreaterThan(0);
	await report(page);
	await expectReport(page, 180, 94);
	return page.workers().find((worker) => worker.url().includes('ledger.worker'))!;
}

for (const path of ['main.bean', 'included.bean'] as const) {
	test(`OPFS ${path} same-length save refreshes warm reports/cache, cold reload and valid-invalid-valid recovery`, async ({
		page,
		context
	}) => {
		const requests: string[] = [];
		context.on('request', (request) => {
			if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
		});
		const worker = await seed(page);
		expect(worker).toBeDefined();
		const before = await storedState(page);
		const oldCache = await cacheMetadata(page);
		const changed = files[path]
			.replaceAll(
				path === 'main.bean' ? '20 USD' : '30 RUB',
				path === 'main.bean' ? '90 USD' : '80 RUB'
			)
			.replaceAll(
				path === 'main.bean' ? '100 USD' : '40 RUB',
				path === 'main.bean' ? '200 USD' : '60 RUB'
			);
		expect(changed.length).toBe(files[path].length);
		const root = path === 'main.bean' ? 90 : 20;
		const included = path === 'included.bean' ? 80 : 30;
		const rootIncome = path === 'main.bean' ? 200 : 100;
		const includedIncome = path === 'included.bean' ? 60 : 40;
		const income = rootIncome + 2 * includedIncome;
		const expenses = root + 2 * (included + 7);
		await edit(page, path, changed);
		const updatedCache = await cacheMetadata(page);
		expect(updatedCache.sourceHash).not.toBe(oldCache.sourceHash);
		expect(updatedCache.binaryHash).not.toBe(oldCache.binaryHash);
		await report(page);
		expect(page.workers()).toContain(worker);
		await expectReport(page, income, expenses);
		await expectPostings(page, root, included, true, false, rootIncome, includedIncome);
		await report(page);
		await page.reload();
		await expectReport(page, income, expenses);
		await expectPostings(page, root, included, true, false, rootIncome, includedIncome);
		// Genuine book diagnostics must appear, and recovery must keep the overlay and amounts.
		await edit(page, path, changed + draft.replace('Incomplete local draft', 'Genuine book error'));
		await report(page);
		await expectDiagnostics(page, 'Genuine book error');
		await expectPostings(page, root, included, true, true, rootIncome, includedIncome);
		await report(page);
		await page.reload();
		await expectDiagnostics(page, 'Genuine book error');
		await edit(page, path, changed);
		await report(page);
		await expectReport(page, income, expenses);
		await expectPostings(page, root, included, true, false, rootIncome, includedIncome);
		await report(page);
		await page.reload();
		await expectReport(page, income, expenses);
		expect(await cacheMetadata(page)).toEqual(updatedCache);
		expect(await storedState(page)).toEqual({
			...before,
			sources: { ...before.sources, [path]: changed }
		});
		expect(requests).toEqual([]);
	});
}

test('QA: OPFS edit → incomplete local drafts → diagnostics → Delete All → another include edit preserves the book', async ({
	page,
	context
}) => {
	const requests: string[] = [];
	context.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
	});
	const worker = await seed(page);
	const before = await storedState(page);
	const root = files['main.bean'].replaceAll('20 USD', '90 USD');
	await edit(page, 'main.bean', root);
	await report(page);
	await expectReport(page, 180, 164);
	// Capture the incomplete transaction through the retained manual-entry UI, not fixture injection.
	await navigate(page, 'Journal');
	await page.locator('button.fixed').click();
	await page.getByTitle('Note').fill('Incomplete local draft');
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByRole('main')).toContainText('Incomplete local draft');
	await report(page);
	await expectDiagnostics(page, 'Incomplete local draft');
	const withDraft = await storedState(page);
	expect(withDraft.sources['cashier.bean']).toContain(files['cashier.bean']);
	expect(withDraft.sources['cashier.bean']).toContain('Incomplete local draft');
	await navigate(page, 'Journal');
	await page.locator('.navbar .dropdown > button').click();
	await page.getByText('Delete All', { exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click();
	await expect(page.getByText('All local transactions deleted.', { exact: true })).toBeVisible();
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await report(page);
	expect(page.workers()).toContain(worker);
	await expectReport(page, 180, 150);
	await expectPostings(page, 90, 30, false);
	await report(page);
	await page.reload();
	await expectReport(page, 180, 150);
	await expectPostings(page, 90, 30, false);
	const included = files['included.bean'].replaceAll('30 RUB', '80 RUB');
	await edit(page, 'included.bean', included);
	await report(page);
	await expectReport(page, 180, 250);
	await expectPostings(page, 90, 80, false);
	await report(page);
	await page.reload();
	await expectReport(page, 180, 250);
	expect(await storedState(page)).toEqual({
		...before,
		sources: { ...before.sources, 'cashier.bean': '', 'main.bean': root, 'included.bean': included }
	});
	expect(requests).toEqual([]);
});
