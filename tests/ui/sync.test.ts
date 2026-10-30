import { expect, test, type Page } from '@playwright/test';

const apiBase = 'https://cashier.test/api';
const token = 'testonlytoken';
const baseBook = `option "operating_currency" "USD"\n2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n`;

type MockOptions = { rejectReason?: string; failPullOnce?: boolean };

async function seedApp(page: Page, localTransactions: string) {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();

	await page.evaluate(
		async ({ settings, localTransactions }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = db.transaction('settings', 'readwrite');
				for (const [key, value] of Object.entries(settings)) {
					transaction.objectStore('settings').put({ key, value: JSON.stringify(value) });
				}
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
			db.close();

			const root = await navigator.storage.getDirectory();
			const handle = await root.getFileHandle('cashier.bean', { create: true });
			const writer = await handle.createWritable();
			await writer.write(localTransactions);
			await writer.close();
		},
		{
			settings: {
				ledgerDataSource: 'beancount',
				syncServerUrl: apiBase,
				syncApiToken: token,
				syncBeancountRootFile: 'main.bean',
				syncLedgerFiles: true,
				syncAccounts: false,
				syncPayees: false,
				ledgerCacheEnabled: false,
				userBookFilename: 'main.bean'
			},
			localTransactions
		}
	);

	await page.reload();
	await page.goto('/sync');
	await expect(page.getByRole('button', { name: 'Synchronize' })).toBeEnabled();
	await expect(page.getByLabel('Ledger files to OPFS')).toBeChecked();
}

async function readCashierFile(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('cashier.bean');
		return (await handle.getFile()).text();
	});
}

async function mockServer(page: Page, options: MockOptions = {}) {
	const accepted: string[] = [];
	const acceptedById = new Map<string, string>();
	const posts: string[][] = [];
	const unexpectedRequests: string[] = [];
	let pullFailuresRemaining = options.failPullOnce ? 1 : 0;

	await page.route(`${apiBase}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (request.method() === 'POST' && url.pathname === '/api/xact') {
			expect(request.headers().authorization).toBe(`Bearer ${token}`);
			const body = request.postDataJSON() as { transactions: string[] };
			posts.push(body.transactions);
			if (options.rejectReason) {
				const rejected = body.transactions.map((rawText) => ({
					cashier_id: rawText.match(/^\s+cashier_id:\s*"([^"]*)"/m)?.[1] ?? null,
					reason: options.rejectReason
				}));
				await route.fulfill({ json: { synchronized: [], rejected } });
			} else {
				const synchronized = body.transactions.map((rawText) => {
					const cashierId = rawText.match(/^\s+cashier_id:\s*"([^"]*)"/m)?.[1];
					if (cashierId && !acceptedById.has(cashierId)) {
						acceptedById.set(cashierId, rawText);
						accepted.push(rawText);
					}
					return cashierId;
				});
				await route.fulfill({ json: { synchronized, rejected: [] } });
			}
			return;
		}

		if (request.method() === 'GET' && url.pathname === '/api/infrastructure') {
			expect(request.headers().authorization).toBe(`Bearer ${token}`);
			expect(url.searchParams.get('file_path')).toBe('main.bean');
			if (pullFailuresRemaining > 0) {
				pullFailuresRemaining--;
				await route.fulfill({ status: 503, body: 'mock pull unavailable' });
				return;
			}
			const transactions = options.rejectReason ? [] : accepted;
			await route.fulfill({
				json: { content: `${baseBook}${transactions.length ? `${transactions.join('\n')}\n` : ''}` }
			});
			return;
		}

		unexpectedRequests.push(`${request.method()} ${request.url()}`);
		await route.abort('failed');
	});

	return { accepted, acceptedById, posts, unexpectedRequests };
}

async function synchronize(page: Page, expectedLocalNote?: string, expectedError?: string) {
	await page.getByRole('button', { name: 'Synchronize' }).click();
	if (expectedLocalNote) {
		await expect.poll(() => readCashierFile(page)).not.toContain(expectedLocalNote);
	}
	if (expectedError) await expect(page.getByRole('alert')).toContainText(expectedError);
}

test('mock API: completed transaction is pushed, pulled, reconciled once, and not reposted', async ({
	page
}) => {
	const note = `UI sync completed ${Date.now()}`;
	const mock = await mockServer(page);
	await seedApp(
		page,
		`2025-01-02 * "Cafe" "${note}"\n  Expenses:Food  12.50 USD\n  Assets:Cash  -12.50 USD\n`
	);

	await synchronize(page, note);
	const localAfterFirstSync = await readCashierFile(page);
	expect(localAfterFirstSync).not.toContain(note);
	expect(mock.posts).toHaveLength(1);
	expect(mock.posts[0]).toHaveLength(1);
	expect(mock.posts[0][0]).toContain(note);
	const cashierId = mock.posts[0][0].match(/^\s+cashier_id:\s*"([^"]*)"/m)?.[1];
	expect(cashierId).toBeTruthy();

	const downloaded = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('main.bean');
		return (await handle.getFile()).text();
	});
	expect(downloaded.match(new RegExp(`cashier_id: "${cashierId}"`, 'g'))).toHaveLength(1);

	await synchronize(page, note);
	expect(mock.posts).toHaveLength(1);
	const localAfterRepeat = await readCashierFile(page);
	expect(localAfterRepeat).not.toContain(note);
	await page.getByRole('link', { name: 'Journal' }).click();
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	expect(mock.unexpectedRequests).toEqual([]);
});

test('mock API: incomplete local transaction stays local and is not sent', async ({ page }) => {
	const note = `UI sync incomplete ${Date.now()}`;
	const mock = await mockServer(page);
	await seedApp(
		page,
		`2025-01-03 ! "Cafe" "${note}"\n  Expenses:Food  7.00 USD\n  Assets:Cash  -7.00 USD\n`
	);

	await synchronize(page);
	const local = await readCashierFile(page);
	expect(local).toContain(note);
	expect(local).toContain('2025-01-03 !');
	expect(local).not.toContain('cashier_id:');
	expect(mock.posts).toEqual([]);
	await page.getByRole('link', { name: 'Journal' }).click();
	await expect(page.locator('body')).toContainText(note);
	await page.reload();
	await expect(page.locator('body')).toContainText(note);
	const reloadedLocal = await readCashierFile(page);
	expect(reloadedLocal).toContain('2025-01-03 !');
	expect(mock.unexpectedRequests).toEqual([]);
});

test('mock API: rejected completed transaction retains its local copy and shows the server reason', async ({
	page
}) => {
	const note = `UI sync rejected ${Date.now()}`;
	const rejection = 'Unknown account Expenses:Food';
	const mock = await mockServer(page, { rejectReason: rejection });
	await seedApp(
		page,
		`2025-01-04 * "Cafe" "${note}"\n  Expenses:Food  9.00 USD\n  Assets:Cash  -9.00 USD\n`
	);

	await synchronize(page, undefined, rejection);
	await expect(page.getByRole('alert')).toContainText(rejection);
	const local = await readCashierFile(page);
	expect(local).toContain(note);
	expect(local).toContain('cashier_id:');
	expect(mock.posts).toHaveLength(1);
	expect(mock.posts[0]).toHaveLength(1);
	await page.getByRole('link', { name: 'Journal' }).click();
	await expect(page.locator('body')).toContainText(note);
	expect(mock.unexpectedRequests).toEqual([]);
});

test('mock API: accepted transaction survives a failed pull and retries with the same ID', async ({
	page
}) => {
	const note = `UI sync retry ${Date.now()}`;
	const mock = await mockServer(page, { failPullOnce: true });
	await seedApp(
		page,
		`2025-01-05 * "Cafe" "${note}"\n  Expenses:Food  14.00 USD\n  Assets:Cash  -14.00 USD\n`
	);

	await synchronize(page, undefined, 'pull: Error reading infrastructure file: main.bean');
	const localAfterFailure = await readCashierFile(page);
	expect(localAfterFailure).toContain(note);
	const firstCashierId = localAfterFailure.match(/^\s+cashier_id:\s*"([^"]*)"/m)?.[1];
	expect(firstCashierId).toBeTruthy();
	expect(mock.posts).toHaveLength(1);
	expect(mock.posts[0][0]).toContain(`cashier_id: "${firstCashierId}"`);
	expect(mock.acceptedById.size).toBe(1);

	await synchronize(page, note);
	expect(mock.posts).toHaveLength(2);
	expect(mock.posts[1]).toHaveLength(1);
	expect(mock.posts[1][0]).toContain(`cashier_id: "${firstCashierId}"`);
	expect(mock.acceptedById.size).toBe(1);
	const localAfterRetry = await readCashierFile(page);
	expect(localAfterRetry).not.toContain(note);

	const downloaded = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('main.bean');
		return (await handle.getFile()).text();
	});
	expect(downloaded.match(new RegExp(`cashier_id: "${firstCashierId}"`, 'g'))).toHaveLength(1);
	await page.getByRole('link', { name: 'Journal' }).click();
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	expect(mock.unexpectedRequests).toEqual([]);
});
