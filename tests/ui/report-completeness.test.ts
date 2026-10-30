import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import init, { Ledger, version } from '@rustledger/wasm';

const reportDate = '2026-10-28';
const selectedBook = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2000-01-01 open Income:Salary
include "included.bean"
2026-10-01 ! "Selected interpolated expense"
  Expenses:Food
  Assets:Cash -10 USD
2026-10-01 ! "Selected interpolated income"
  Income:Salary
  Assets:Cash 100 USD
`;
const includedBook = `2026-10-01 price LONGCOIN 3 USD
2026-10-02 ! "Selected included long commodity"
  Expenses:Food 2 LONGCOIN
  Assets:Cash -2 LONGCOIN
`;
const overlay = `2026-10-03 ! "Local completed expense"
  cashier_id: "synthetic-report-expense"
  Expenses:Food 5 USD
  Assets:Cash -5 USD
2026-10-04 ! "Local refund"
  cashier_id: "synthetic-report-refund"
  Expenses:Food -2 USD
  Assets:Cash 2 USD
`;
const unresolved = `2026-10-05 ! "Unresolved report posting"
  Expenses:Food
  Assets:Cash
`;
const corrected = unresolved.replace(
	'Expenses:Food\n  Assets:Cash',
	'Expenses:Food 7 USD\n  Assets:Cash -7 USD'
);
const reports = ['expenses', 'income-expense'] as const;
type Report = (typeof reports)[number];
type Source = 'overlay' | 'selected';

function sources(source: Source, fixed = false) {
	const transaction = fixed ? corrected : unresolved;
	return {
		'cashier.bean': overlay + (source === 'overlay' ? transaction : ''),
		'selected.bean': selectedBook + (source === 'selected' ? transaction : ''),
		'included.bean': includedBook
	};
}

function analysisLedger(files: ReturnType<typeof sources>) {
	// The worker injects the selected-book include in memory, never into the overlay on disk.
	return Ledger.fromFiles(
		{ ...files, 'cashier.bean': `include "selected.bean"\n${files['cashier.bean']}` },
		'cashier.bean'
	);
}

const caches = new Map<Source, number[]>();
test.beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
	expect(version()).toBe('0.14.1');
	for (const source of ['overlay', 'selected'] as const) {
		const ledger = analysisLedger(sources(source));
		try {
			const result = ledger.query(
				'SELECT position WHERE account ~ "^Expenses" AND position IS NULL'
			);
			expect(result.errors).toEqual([]);
			expect(result.rows).toEqual([[null]]);
			caches.set(source, Array.from(ledger.serialize()));
		} finally {
			ledger.free();
		}
	}
});

async function seed(page: Page, source: Source, caching: boolean) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ files, caching, cache }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction('settings', 'readwrite');
					for (const [key, value] of Object.entries({
						ledgerDataSource: 'beancount',
						userBookFilename: 'selected.bean',
						currency: 'USD',
						ledgerCacheEnabled: caching
					}))
						tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.onabort = () => reject(tx.error);
				});
			} finally {
				db.close();
			}
			const root = await navigator.storage.getDirectory();
			for (const [name, content] of Object.entries(files)) {
				const file = await root.getFileHandle(name, { create: true });
				const writer = await file.createWritable();
				await writer.write(content);
				await writer.close();
			}
			const binary = await root.getFileHandle('ledger-cache.bin', { create: true });
			const writer = await binary.createWritable();
			await writer.write(new Uint8Array(cache));
			await writer.close();
		},
		{ files: sources(source), caching, cache: caches.get(source)! }
	);
}

async function navigate(page: Page, group: string, link: string) {
	const sidebar = page.locator('aside');
	const section = sidebar
		.locator('details')
		.filter({ has: page.getByText(group, { exact: true }) });
	if (!(await section.evaluate((element) => (element as HTMLDetailsElement).open))) {
		await section.locator('summary').click();
	}
	await section.getByRole('link', { name: link, exact: true }).click();
}

async function openReport(page: Page, report: Report) {
	await navigate(page, 'Analysis', 'Reports');
	await expect(page).toHaveURL(/\/reports$/);
	await page
		.locator('article')
		.getByRole('link', {
			name: report === 'expenses' ? 'Expenses' : 'Income vs Expenses',
			exact: true
		})
		.click();
	await expect(page).toHaveURL(new RegExp(`/reports/${report}$`));
}

async function expectIncomplete(page: Page, report: Report) {
	const article = page.locator('article');
	const status = article.getByRole('status');
	await expect(status).toContainText('Report incomplete — totals and charts are hidden.');
	await expect(status).toContainText('Correct the source data and reload the ledger');
	const summary = status.locator('summary');
	await expect(summary).toHaveText(/Report diagnostics \([1-9]\d*\)/);
	// Native details are keyboard accessible; diagnostics must not be a console-only error.
	await summary.focus();
	await page.keyboard.press('Enter');
	await expect(
		status.getByText(/2026-10-05 · Expenses:Food · Unresolved report posting/)
	).toBeVisible();
	await expect(status.getByText(/Unresolved posting amount/)).toBeVisible();
	await expect(status.getByText(/Transaction has 2 postings with missing amounts/)).toBeVisible();
	await expect(article.locator('canvas')).toHaveCount(0);
	await expect(article.getByText('Total:', { exact: true })).toHaveCount(0);
	await expect(article.getByRole('button', { name: /^Income \(|^Expenses \(/ })).toHaveCount(0);
	await expect(article.getByText(/No expense data|No data available/)).toHaveCount(0);
	await expect(article).not.toContainText('UNITS expects a position or inventory');
	if (report === 'expenses') {
		await article.getByRole('button', { name: 'Donut chart' }).click();
		await expect(article.locator('canvas')).toHaveCount(0);
		await expect(article.getByText('Total:', { exact: true })).toHaveCount(0);
	}
}

async function expectComplete(page: Page, report: Report) {
	const article = page.locator('article');
	await expect(article.locator('canvas')).toBeVisible();
	await expect(article.getByRole('status')).toHaveCount(0);
	await expect(article.getByText(/Report diagnostics/)).toHaveCount(0);
	await expect(article).toContainText('Valuation: USD');
	if (report === 'expenses') {
		await expect(article.getByText('Total:', { exact: true })).toBeVisible();
		await expect(article.getByText('26.00 USD', { exact: true })).toBeVisible();
	} else {
		await expect(
			article.getByRole('button', { name: 'Income (100.00 USD)', exact: true })
		).toBeVisible();
		const expenses = article.getByRole('button', { name: 'Expenses (26.00 USD)', exact: true });
		await expect(expenses).toBeVisible();
		await expenses.click();
		const month = article
			.locator('details')
			.filter({ has: page.locator('summary').filter({ hasText: 'Oct 26' }) });
		await month.locator('summary').click();
		await expect(month.getByRole('link', { name: 'Oct 4 -2.00 USD', exact: true })).toBeVisible();
		await expect(month.getByRole('link', { name: 'Oct 5 7.00 USD', exact: true })).toBeVisible();
	}
}

for (const source of ['overlay', 'selected'] as const) {
	for (const caching of [false, true]) {
		test(`both reports: null posting in ${source}, cache ${caching}; editor save and validation reload recover`, async ({
			page,
			context
		}) => {
			test.setTimeout(45_000);
			page.setDefaultTimeout(10_000);
			await page.setViewportSize({ width: 1280, height: 1000 });
			await page.clock.setFixedTime(new Date(`${reportDate}T12:00:00Z`));
			const errors: string[] = [];
			const apiRequests: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			context.on('request', (request) => {
				if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
			});
			await seed(page, source, caching);
			const workers: string[] = [];
			page.on('worker', (worker) => workers.push(worker.url()));
			// Start a fresh document after seeding so its actual worker loads OPFS/cache settings.
			// Reverse first-open order as well as source/cache coverage.
			const order = source === 'overlay' ? reports : [...reports].reverse();
			await page.goto(`/reports/${order[0]}`);
			const documentId = await page.evaluate(() => performance.timeOrigin);
			await expectIncomplete(page, order[0]);
			await openReport(page, order[1]);
			await expectIncomplete(page, order[1]);

			await navigate(page, 'Data', 'File Storage');
			const fileName = source === 'overlay' ? 'cashier.bean' : 'selected.bean';
			await page.getByRole('cell').getByText(fileName, { exact: true }).click();
			await expect(page).toHaveURL(
				new RegExp(`/opfs/edit-file\\?file=${fileName.replace('.', '\\.')}$`)
			);
			const editor = page.locator('textarea');
			await expect(editor).toHaveValue(sources(source)[fileName]);
			await editor.fill(sources(source, true)[fileName]);
			await page.getByRole('button', { name: 'Save', exact: true }).click();
			await expect(page.getByText('File saved successfully', { exact: true })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

			await navigate(page, 'Utilities', 'Validation');
			// Saving raw OPFS alone must not be mistaken for refreshed full-book analysis.
			await expect(page.getByText('Invalid', { exact: true })).toBeVisible();
			await page.getByRole('button', { name: 'Reload & Validate', exact: true }).click();
			await expect(page.getByText('All clear!', { exact: true })).toBeVisible();
			await expect(page.getByText('Valid', { exact: true })).toBeVisible();
			for (const report of order) {
				await openReport(page, report);
				await expectComplete(page, report);
			}
			expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentId);
			expect(workers).toHaveLength(1);

			const persisted = await page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				const files: Record<string, string> = {};
				for (const name of ['cashier.bean', 'selected.bean', 'included.bean']) {
					files[name] = await (await (await root.getFileHandle(name)).getFile()).text();
				}
				const cache = await (
					await (await root.getFileHandle('ledger-cache.bin')).getFile()
				).arrayBuffer();
				return { files, cache: Array.from(new Uint8Array(cache)) };
			});
			expect(persisted.files).toEqual(sources(source, true));
			if (caching) {
				// Real invalidation must replace the old incomplete binary, not just the rendered UI.
				const restored = Ledger.fromCache(new Uint8Array(persisted.cache));
				try {
					expect(restored.getErrors()).toEqual([]);
					expect(restored.query('SELECT position WHERE position IS NULL').rows).toEqual([]);
				} finally {
					restored.free();
				}
			}
			// A new document/worker must also recover from the persisted sources or refreshed cache.
			await page.reload();
			await expectComplete(page, order[1]);
			expect(workers).toHaveLength(2);
			expect(apiRequests).toEqual([]);
			expect(errors).toEqual([]);
		});
	}
}
