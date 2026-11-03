import { expect, test, type Page } from '@playwright/test';

// Cache construction goes through the application's actual worker/WASM, not a
// hand-built metadata fixture. Each test owns an isolated browser origin store.
const accounts = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2000-01-01 open Income:Salary
`;
const entry = (
	amount: number,
	description: string,
	currency = 'USD'
) => `2026-10-01 * "${description}"
  Expenses:Food ${amount} ${currency}
  Assets:Cash -${amount} ${currency}
`;
const draft = `2026-10-02 ! "Deleted local draft"
  Expenses:Food
  Assets:Cash
`;
const remainingError = draft.replace('Deleted local draft', 'Genuine server error');
const initial = {
	'cashier.bean': entry(10, 'Pending overlay', 'RUB'),
	'main.bean': `${accounts}${entry(20, 'Selected root')}include "included.bean"\n`,
	'included.bean': entry(30, 'Selected include'),
	'unrelated.txt': 'Keep this file unchanged'
};

async function writeFiles(page: Page, files: Record<string, string>) {
	await page.evaluate(async (sources) => {
		const root = await navigator.storage.getDirectory();
		for (const [path, content] of Object.entries(sources)) {
			const writer = await (await root.getFileHandle(path, { create: true })).createWritable();
			await writer.write(content);
			await writer.close();
		}
	}, files);
}
async function selectBook(page: Page, filename = 'main.bean') {
	await page.evaluate(async (filename) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('settings', 'readwrite');
				for (const [key, value] of Object.entries({
					userBookFilename: filename,
					ledgerCacheEnabled: true,
					currency: 'USD',
					syncApiToken: 'cache-test-token'
				})) {
					tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
				}
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	}, filename);
}
async function seed(page: Page, files = initial) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await writeFiles(page, files);
	await selectBook(page);
	await page.goto('/util/validation');
	// This invokes worker invalidation and persists its validated cache. The
	// serialization demo also hashes on the main thread, outside this cache path.
	await page.getByRole('button', { name: 'Reload & Validate', exact: true }).click();
	await expect(
		page.getByText(files['cashier.bean'].includes('Deleted local draft') ? 'Invalid' : 'Valid', {
			exact: true
		})
	).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(async () => {
				const root = await navigator.storage.getDirectory();
				return (await (await root.getFileHandle('ledger-cache.bin.json')).getFile()).size;
			})
		)
		.toBeGreaterThan(0);
}
async function queryRows(page: Page) {
	await page
		.locator('textarea')
		.fill(
			'SELECT number, currency, description WHERE account = "Expenses:Food" ORDER BY description'
		);
	await page.getByRole('button', { name: 'Query', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Query', exact: true })).toBeEnabled();
	return page.locator('tbody tr');
}
async function assertFiles(page: Page, expected: Record<string, string>) {
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
async function navigate(page: Page, link: string) {
	const target = page
		.locator('aside')
		.getByRole('link', { name: link, exact: true, includeHidden: true });
	const details = target.locator('xpath=ancestor::details');
	if (
		(await details.count()) &&
		!(await details.evaluate((element) => (element as HTMLDetailsElement).open))
	)
		await details.locator('summary').click();
	await target.click();
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));
});

for (const path of ['cashier.bean', 'main.bean', 'included.bean'] as const) {
	test(`cold cache rejects same-length ${path} edit and preserves other sources`, async ({
		page
	}) => {
		await seed(page);
		const old = initial[path];
		const changed = old.replace(/(10|20|30) (USD|RUB)/g, '90 $2');
		expect(changed.length).toBe(old.length);
		expect(changed).not.toBe(old);
		await writeFiles(page, { [path]: changed });
		await page.goto('/reports/query');
		let rows = await queryRows(page);
		await expect(rows).toHaveCount(3);
		await expect(
			rows.filter({
				hasText:
					path === 'cashier.bean'
						? 'Pending overlay'
						: path === 'main.bean'
							? 'Selected root'
							: 'Selected include'
			})
		).toContainText('90');
		await expect(rows.filter({ hasText: 'Pending overlay' })).toContainText('RUB');
		await page.reload();
		rows = await queryRows(page);
		await expect(rows).toHaveCount(3);
		await assertFiles(page, { ...initial, [path]: changed });
	});
}

for (const kind of ['missing-metadata', 'corrupt-metadata', 'corrupt-binary'] as const) {
	test(`cold ${kind} cache falls back to source book`, async ({ page }) => {
		await seed(page);
		await page.evaluate(async (kind) => {
			const root = await navigator.storage.getDirectory();
			if (kind === 'missing-metadata') {
				await root.removeEntry('ledger-cache.bin.json');
				return;
			}
			const name = kind === 'corrupt-binary' ? 'ledger-cache.bin' : 'ledger-cache.bin.json';
			const writer = await (await root.getFileHandle(name)).createWritable();
			await writer.write('corrupt');
			await writer.close();
		}, kind);
		await page.goto('/reports/query');
		const rows = await queryRows(page);
		await expect(rows).toHaveCount(3);
		await expect(rows.filter({ hasText: 'Selected include' })).toContainText('30');
		await expect(rows.filter({ hasText: 'Pending overlay' })).toContainText('RUB');
		await assertFiles(page, initial);
	});
}

test('cold cache honors a changed selected root and a deleted include', async ({ page }) => {
	await seed(page);
	const other = accounts + entry(80, 'Replacement root');
	await writeFiles(page, { 'other.bean': other });
	await selectBook(page, 'other.bean');
	await page.goto('/reports/query');
	const rows = await queryRows(page);
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: 'Replacement root' })).toContainText('80');
	await expect(rows.filter({ hasText: 'Selected root' })).toHaveCount(0);
	await selectBook(page);
	await page.evaluate(async () =>
		(await navigator.storage.getDirectory()).removeEntry('included.bean')
	);
	await page.goto('/util/validation');
	await expect(page.getByText('Invalid', { exact: true })).toBeVisible();
	await expect(page.locator('main main')).toContainText('included.bean');
});

test('failed worker cache rewrite is visible and the next document rejects the surviving old binary', async ({
	page
}) => {
	await seed(page);
	const oldBinary = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		return Array.from(
			new Uint8Array(
				await (await (await root.getFileHandle('ledger-cache.bin')).getFile()).arrayBuffer()
			)
		);
	});
	const worker = page.workers().find((worker) => worker.url().includes('ledger.worker'));
	expect(worker).toBeDefined();
	await worker!.evaluate(() => {
		const original = FileSystemFileHandle.prototype.createWritable;
		FileSystemFileHandle.prototype.createWritable = async function (options) {
			if (this.name === 'ledger-cache.bin')
				throw new DOMException('Cache write denied for regression', 'QuotaExceededError');
			return original.call(this, options);
		};
	});
	const changed = initial['main.bean'].replaceAll('20 USD', '90 USD');
	await writeFiles(page, { 'main.bean': changed });
	await navigate(page, 'Validation');
	await page.getByRole('button', { name: 'Reload & Validate', exact: true }).click();
	await expect(page.getByText('Failed to load ledger', { exact: true })).toBeVisible();
	await expect(page.locator('main main')).toContainText('Cache write denied for regression');
	const persisted = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		let hasMetadata = true;
		try {
			await root.getFileHandle('ledger-cache.bin.json');
		} catch {
			hasMetadata = false;
		}
		return {
			hasMetadata,
			binary: Array.from(
				new Uint8Array(
					await (await (await root.getFileHandle('ledger-cache.bin')).getFile()).arrayBuffer()
				)
			)
		};
	});
	expect(persisted).toEqual({ hasMetadata: false, binary: oldBinary });
	await page.goto('/reports/query');
	const rows = await queryRows(page);
	await expect(rows).toHaveCount(3);
	await expect(rows.filter({ hasText: 'Selected root' })).toContainText('90');
	await expect(rows.filter({ hasText: 'Pending overlay' })).toContainText('RUB');
	await assertFiles(page, { ...initial, 'main.bean': changed });
});

test('QA order: OPFS edit, incomplete drafts, Delete All, cold reload keeps real book errors and amounts', async ({
	page,
	context
}) => {
	const files = {
		...initial,
		'cashier.bean': draft,
		'included.bean': initial['included.bean'] + remainingError
	};
	const requests: string[] = [];
	context.on('request', (request) => {
		if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
	});
	await seed(page, files);
	await page.goto('/reports/income-expense');
	await expect(page.getByRole('status')).toContainText('Report incomplete');
	await navigate(page, 'File Storage');
	await page.getByRole('cell').getByText('main.bean', { exact: true }).click();
	const changed = files['main.bean'].replaceAll('20 USD', '90 USD');
	await page.locator('textarea').fill(changed);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('File saved successfully', { exact: true })).toBeVisible();
	await navigate(page, 'Journal');
	await page.locator('.navbar .dropdown > button').click();
	await page.getByText('Delete All', { exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'OK', exact: true }).click();
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	// Warm notification is deliberately left to sections 11/12. No validation reload or cache toggle.
	await page.goto('/reports/income-expense');
	const status = page.getByRole('status');
	await expect(status).toContainText('Report incomplete');
	await status.locator('summary').click();
	await expect(status).toContainText('Genuine server error');
	await expect(status).not.toContainText('Deleted local draft');
	await page.goto('/reports/query');
	const rows = await queryRows(page);
	await expect(rows).toHaveCount(3);
	await expect(rows.filter({ hasText: 'Selected root' })).toContainText('90');
	await expect(rows.filter({ hasText: 'Genuine server error' })).toHaveCount(1);
	await expect(rows.filter({ hasText: 'Deleted local draft' })).toHaveCount(0);
	const journal = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		return (await (await root.getFileHandle('cashier.bean')).getFile()).text();
	});
	expect(journal).toBe('');
	await assertFiles(page, { ...files, 'cashier.bean': journal, 'main.bean': changed });
	const settings = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await Promise.all(
				['syncApiToken', 'userBookFilename', 'ledgerCacheEnabled'].map(
					(key) =>
						new Promise((resolve, reject) => {
							const request = db.transaction('settings').objectStore('settings').get(key);
							request.onsuccess = () => resolve(request.result);
							request.onerror = () => reject(request.error);
						})
				)
			);
		} finally {
			db.close();
		}
	});
	expect(settings).toEqual([
		{ key: 'syncApiToken', value: JSON.stringify('cache-test-token') },
		{ key: 'userBookFilename', value: JSON.stringify('main.bean') },
		{ key: 'ledgerCacheEnabled', value: 'true' }
	]);
	expect(requests).toEqual([]);
});
