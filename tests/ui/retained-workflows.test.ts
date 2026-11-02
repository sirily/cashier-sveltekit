import { expect, test, type Download, type Page, type Request } from '@playwright/test';
import type { ScheduledTransaction } from '../../src/lib/data/model';

const prefix = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash USD
2000-01-01 open Expenses:Food USD
`;
const before = `2025-01-01 ! "Neighbor before" "Keep before delete"
  cashier_id: "retained-before-id"
  Expenses:Food  3.00 USD
  Assets:Cash  -3.00 USD
`;
const target = `2025-01-02 * "Cafe" "Delete only this entry"
  cashier_id: "retained-delete-id"
  Expenses:Food  12.50 USD
  Assets:Cash  -12.50 USD
`;
const after = `2025-01-03 * "Neighbor after" "Keep after delete"
  cashier_id: "retained-after-id"
  Expenses:Food  7.00 USD
  Assets:Cash  -7.00 USD
`;
const journal = `${prefix}${before}\n${target}\n${after}`;
const apiToken = 'retained-workflow-test-only-secret';
const seedSettings = {
	ledgerDataSource: 'beancount',
	userBookFilename: 'cashier.bean',
	ledgerCacheEnabled: false,
	currency: 'USD',
	dateFormat: 'YYYY-MM-DD',
	syncServerUrl: 'https://cashier.test/api',
	syncApiToken: apiToken
};
const scheduled: ScheduledTransaction[] = [
	{
		id: 41,
		nextDate: '2099-01-15',
		period: '1 month',
		count: 3,
		endDate: null,
		remarks: 'Retained monthly schedule',
		transaction: {
			date: '2099-01-15',
			flag: '*',
			payee: 'Scheduled cafe',
			note: 'Scheduled food',
			postings: [
				{ account: 'Expenses:Food', amount: 15.5, currency: 'USD' },
				{ account: 'Assets:Cash', amount: -15.5, currency: 'USD' }
			]
		}
	},
	{
		id: 42,
		nextDate: '2099-02-20',
		period: '1 year',
		count: 1,
		endDate: null,
		remarks: 'Retained annual schedule',
		transaction: {
			date: '2099-02-20',
			flag: '!',
			payee: 'Scheduled shop',
			note: 'Scheduled annual food',
			postings: [
				{ account: 'Expenses:Food', amount: 25, currency: 'USD' },
				{ account: 'Assets:Cash', amount: -25, currency: 'USD' }
			]
		}
	}
];

type StoredSetting = { key: string; value: string };
type LocalRecords = { settings: StoredSetting[]; scheduled: ScheduledTransaction[] };
type Backup = { settings: StoredSetting[]; scx: ScheduledTransaction[] };

async function seedLocalData(page: Page) {
	const browserErrors: string[] = [];
	page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
	});

	// Playwright's page/context fixtures isolate storage for each test. Let the app create its schema.
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(
		async ({ journal, settings, scheduled }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			try {
				await new Promise<void>((resolve, reject) => {
					const tx = db.transaction(['settings', 'scheduled'], 'readwrite');
					for (const [key, value] of Object.entries(settings)) {
						tx.objectStore('settings').put({ key, value: JSON.stringify(value) });
					}
					for (const record of scheduled) tx.objectStore('scheduled').put(record);
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
					tx.onabort = () => reject(tx.error);
				});
			} finally {
				db.close();
			}

			const root = await navigator.storage.getDirectory();
			const handle = await root.getFileHandle('cashier.bean', { create: true });
			const writer = await handle.createWritable();
			await writer.write(journal);
			await writer.close();
		},
		{ journal, settings: seedSettings, scheduled }
	);
	await page.reload();
	await page.getByRole('link', { name: 'Journal', exact: true }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByRole('main')).toContainText('Delete only this entry');
	return browserErrors;
}

async function readJournal(page: Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const handle = await root.getFileHandle('cashier.bean');
		return (await handle.getFile()).text();
	});
}

async function readLocalRecords(page: Page): Promise<LocalRecords> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('Cashier');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise<LocalRecords>((resolve, reject) => {
				const tx = db.transaction(['settings', 'scheduled'], 'readonly');
				const settings = tx.objectStore('settings').getAll();
				const scheduled = tx.objectStore('scheduled').getAll();
				tx.oncomplete = () => resolve({ settings: settings.result, scheduled: scheduled.result });
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			});
		} finally {
			db.close();
		}
	});
}

async function downloadText(download: Download) {
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	expect(await download.failure()).toBeNull();
	return Buffer.concat(chunks).toString('utf8');
}

test('offline journal delete removes only the selected entry and preserves neighbors after reload', async ({
	page,
	context
}) => {
	const browserErrors = await seedLocalData(page);
	await page.getByText('Delete only this entry', { exact: false }).click();
	await expect(page).toHaveURL(/\/xact-actions$/);
	await page.getByRole('button', { name: 'Delete', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'Confirm Delete' })).toBeVisible();

	const requests: string[] = [];
	const recordRequest = (request: Request) => {
		if (['fetch', 'xhr'].includes(request.resourceType())) {
			requests.push(`${request.method()} ${request.url()}`);
		}
	};
	await context.setOffline(true);
	page.on('request', recordRequest);
	await dialog.getByRole('button', { name: 'OK', exact: true }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByRole('main')).not.toContainText('Delete only this entry');
	await expect(page.getByRole('main')).toContainText('Keep before delete');
	await expect(page.getByRole('main')).toContainText('Keep after delete');
	const saved = await readJournal(page);
	page.off('request', recordRequest);
	expect(requests).toEqual([]);
	expect(saved.startsWith(prefix + before)).toBe(true);
	expect(saved.endsWith(after)).toBe(true);
	expect(saved).not.toContain('Delete only this entry');
	expect(saved).not.toContain('retained-delete-id');
	expect(saved.match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(2);
	expect(saved.match(/^[ \t]+cashier_id:.*$/gm)).toEqual([
		'  cashier_id: "retained-before-id"',
		'  cashier_id: "retained-after-id"'
	]);

	// Reload durability is separate from the offline mutation; preview need not have an active SW.
	await context.setOffline(false);
	await page.reload();
	await expect(page.getByRole('main')).toContainText('Keep before delete');
	await expect(page.getByRole('main')).toContainText('Keep after delete');
	await expect(page.getByRole('main')).not.toContainText('Delete only this entry');
	expect(await readJournal(page)).toBe(saved);
	expect(browserErrors).toEqual([]);
});

test('journal export copies and downloads actual content without changing source or cashier IDs', async ({
	page,
	context
}) => {
	const browserErrors = await seedLocalData(page);
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
		origin: new URL(page.url()).origin
	});
	await page.goto('/export/journal');
	await expect(page.getByText('Export journal', { exact: true })).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveValue(journal);
	const recordsBefore = await readLocalRecords(page);

	await page.evaluate(() => navigator.clipboard.writeText('not the journal'));
	await page.getByRole('button', { name: 'Copy', exact: true }).click();
	await expect(page.getByText('Data copied to clipboard', { exact: true })).toBeVisible();
	const copied = await page.evaluate(() => navigator.clipboard.readText());
	expect(copied).toBe(journal);
	expect(await readJournal(page)).toBe(journal);

	const downloading = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download', exact: true }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toMatch(/^journal_.+\.ledger$/);
	const downloaded = await downloadText(download);
	expect(downloaded).toBe(journal);
	for (const text of [copied, downloaded, await readJournal(page)]) {
		expect(text.match(/^[ \t]+cashier_id:.*$/gm)).toEqual([
			'  cashier_id: "retained-before-id"',
			'  cashier_id: "retained-delete-id"',
			'  cashier_id: "retained-after-id"'
		]);
	}
	expect(await readLocalRecords(page)).toEqual(recordsBefore);

	await page.reload();
	await expect(page.getByRole('textbox')).toHaveValue(journal);
	expect(await readJournal(page)).toBe(journal);
	await page.getByRole('link', { name: 'Journal', exact: true }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByText('Delete only this entry', { exact: false })).toBeVisible();
	await expect(page.getByText('Keep before delete', { exact: false })).toBeVisible();
	await expect(page.getByText('Keep after delete', { exact: false })).toBeVisible();
	expect(browserErrors).toEqual([]);
});

test('outbound local Backup downloads settings and scheduled content without the sync API token', async ({
	page
}) => {
	const browserErrors = await seedLocalData(page);
	await page.goto('/backup');
	await expect(page.getByRole('heading', { name: 'Create Backup', exact: true })).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveValue(/^cashier-backup_.+\.json$/);
	await expect(
		page.getByText('Journal transactions and book files are not included. Export them separately.')
	).toBeVisible();
	const recordsBefore = await readLocalRecords(page);
	expect(recordsBefore.scheduled).toEqual(scheduled);
	for (const [key, value] of Object.entries(seedSettings)) {
		expect(recordsBefore.settings).toContainEqual({ key, value: JSON.stringify(value) });
	}

	const downloading = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Backup', exact: true }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toMatch(/^cashier-backup_.+\.json$/);
	const text = await downloadText(download);
	const backup = JSON.parse(text) as Backup;
	expect(Object.keys(backup).sort()).toEqual(['scx', 'settings']);
	expect(backup.settings).toEqual(
		recordsBefore.settings.filter(({ key }) => key !== 'syncApiToken')
	);
	expect(backup.scx).toEqual(scheduled);
	expect(text).not.toContain('syncApiToken');
	expect(text).not.toContain(apiToken);
	for (const key of ['webdav-settings', 'pCloudToken', 'backupServerUrl'])
		expect(text).not.toContain(key);
	expect(await readLocalRecords(page)).toEqual(recordsBefore);
	expect(await readJournal(page)).toBe(journal);

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Create Backup', exact: true })).toBeVisible();
	expect(await readLocalRecords(page)).toEqual(recordsBefore);
	expect(await readJournal(page)).toBe(journal);
	expect(browserErrors).toEqual([]);
});

test('scheduled export copies and downloads JSON without changing local data', async ({
	page,
	context
}) => {
	const browserErrors = await seedLocalData(page);
	const recordsBefore = await readLocalRecords(page);
	await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
		origin: new URL(page.url()).origin
	});
	await page.goto('/export/scheduled');
	await expect(page.getByText('Export scheduled', { exact: true })).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveValue(JSON.stringify(scheduled));
	await page.getByRole('button', { name: 'Copy', exact: true }).click();
	await expect(page.getByText('Data copied to clipboard', { exact: true })).toBeVisible();
	expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(scheduled);
	const downloading = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download', exact: true }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toMatch(/^scheduled_.+\.json$/);
	expect(JSON.parse(await downloadText(download))).toEqual(scheduled);
	expect(await readLocalRecords(page)).toEqual(recordsBefore);
	expect(await readJournal(page)).toBe(journal);
	expect(browserErrors).toEqual([]);
});

test('outbound Backup share contains only credential-free settings and scheduled records', async ({
	page
}) => {
	const browserErrors = await seedLocalData(page);
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'share', {
			configurable: true,
			value: async (data: ShareData) => {
				(window as unknown as { sharedBackup: ShareData }).sharedBackup = data;
			}
		});
	});
	await page.goto('/backup');
	await expect(page.getByRole('heading', { name: 'Create Backup', exact: true })).toBeVisible();
	const recordsBefore = await readLocalRecords(page);
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	await expect
		.poll(() =>
			page.evaluate(() => (window as unknown as { sharedBackup?: ShareData }).sharedBackup)
		)
		.toBeTruthy();
	const shared = await page.evaluate(
		() => (window as unknown as { sharedBackup: ShareData }).sharedBackup
	);
	expect(shared.title).toBe('Cashier Backup');
	expect(JSON.parse(shared.text as string)).toEqual({
		settings: recordsBefore.settings.filter(
			({ key }) =>
				!['syncApiToken', 'webdav-settings', 'pCloudToken', 'backupServerUrl'].includes(key)
		),
		scx: scheduled
	});
	expect(shared.text).not.toContain(apiToken);
	expect(await readLocalRecords(page)).toEqual(recordsBefore);
	expect(await readJournal(page)).toBe(journal);
	expect(browserErrors).toEqual([]);
});
