import { expect, test, type Page, type Request } from '@playwright/test';
import { waitForOfflineControl } from './fixtures/offline';

async function openReadyJournal(page: Page) {
	const browserErrors: string[] = [];
	page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
	});

	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.getByRole('link', { name: 'Journal', exact: true }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.locator('main')).toContainText('The device journal is empty');
	await expect(page.getByText('The device journal is empty')).toBeVisible();

	return browserErrors;
}

async function writeLocalJournal(page: Page, source: string) {
	await page.evaluate(async (content) => {
		const directory = await navigator.storage.getDirectory();
		const handle = await directory.getFileHandle('cashier.bean', { create: true });
		const writer = await handle.createWritable();
		await writer.write(content);
		await writer.close();
	}, source);
}

async function readLocalJournal(page: Page) {
	return page.evaluate(async () => {
		const directory = await navigator.storage.getDirectory();
		const handle = await directory.getFileHandle('cashier.bean');
		return (await handle.getFile()).text();
	});
}

test('editing a local transaction preserves its cashier_id across saves and reloads', async ({
	page,
	context
}) => {
	// PWA readiness can arrive after reload and cover the mobile Save FAB.
	const offlineToast = page.locator('.toast').filter({ hasText: 'App ready to work offline' });
	await page.addLocatorHandler(offlineToast, async (toast) => {
		await toast.getByRole('button', { name: 'Close', exact: true }).click();
	});
	const browserErrors = await openReadyJournal(page);
	const originalNote = `UI create ${Date.now()}`;
	const cashierId = 'existing-local-ui-id';
	const prefix = `option "operating_currency" "USD"\n2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n`;
	const transaction = `2025-01-01 * "Cafe" "${originalNote}"\n  cashier_id: "${cashierId}"\n  Expenses:Food  12.50 USD\n  Assets:Cash  -12.50 USD\n`;
	const neighbor = `\n2025-01-02 ! "Neighbor" "Untouched"\n  cashier_id: "neighbor-ui-id"\n  Expenses:Food  3.00 USD\n  Assets:Cash  -3.00 USD\n`;

	await writeLocalJournal(page, prefix + transaction + neighbor);
	await waitForOfflineControl(page);
	await page.reload();
	await expect(page.getByRole('main')).toContainText(originalNote);

	let previousNote = originalNote;
	for (const editedNote of [`UI first edit ${Date.now()}`, `UI second edit ${Date.now()}`]) {
		await page.getByText(previousNote, { exact: false }).click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		await page.getByRole('button', { name: 'Edit' }).click();
		await expect(page).toHaveURL(/\/tx$/);
		await expect(page.getByTitle('Note')).toHaveValue(previousNote);
		await page.getByTitle('Note').fill(editedNote);

		const saveRequests: string[] = [];
		const recordRequest = (request: Request) => {
			if (['fetch', 'xhr'].includes(request.resourceType())) {
				saveRequests.push(`${request.method()} ${request.url()}`);
			}
		};
		await context.setOffline(true);
		page.on('request', recordRequest);
		await page.locator('button.fixed').click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		await expect(page.locator('body')).toContainText(editedNote);
		page.off('request', recordRequest);
		expect(saveRequests).toEqual([]);
		await context.setOffline(false);

		const saved = await readLocalJournal(page);
		expect(saved.startsWith(prefix)).toBe(true);
		expect(saved.endsWith(neighbor)).toBe(true);
		expect(saved.match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(2);
		expect(saved.match(/^[ \t]+cashier_id:.*$/gm)).toEqual([
			`  cashier_id: "${cashierId}"`,
			'  cashier_id: "neighbor-ui-id"'
		]);
		expect(saved.match(new RegExp(editedNote, 'g'))).toHaveLength(1);
		expect(saved).not.toContain(previousNote);
		expect(saved).toContain('Expenses:Food  12.50 USD');
		expect(saved).toContain('Assets:Cash  -12.50 USD');

		await page.getByRole('link', { name: 'Journal' }).click();
		await expect(page).toHaveURL(/\/journal$/);
		await expect(page.getByRole('main')).toContainText(editedNote);
		await expect(page.getByRole('main')).not.toContainText(previousNote);
		await page.reload();
		await expect(page.getByRole('main')).toContainText(editedNote);
		await expect(page.getByRole('main')).not.toContainText(previousNote);
		expect(await readLocalJournal(page)).toBe(saved);
		previousNote = editedNote;
	}
	if (browserErrors.length) throw new Error(browserErrors.join('\n'));
});

for (const { name, savedNote, rejectPostingEdit } of [
	{
		name: 'no-op save preserves exact annotated journal source through offline reload',
		savedNote: 'Lossless edit target',
		rejectPostingEdit: false
	},
	{
		name: 'note-only edit preserves annotations and changes only narration through offline reload',
		savedNote: 'Lossless edited note',
		rejectPostingEdit: false
	},
	{
		name: 'unsafe annotated posting edit keeps source unchanged and the edited form available',
		savedNote: 'Unsaved correction',
		rejectPostingEdit: true
	}
]) {
	test(name, async ({ page, context }) => {
		const offlineToast = page.locator('.toast').filter({ hasText: 'App ready to work offline' });
		await page.addLocatorHandler(offlineToast, async (toast) => {
			await toast.getByRole('button', { name: 'Close', exact: true }).click();
		});
		const browserErrors = await openReadyJournal(page);
		const originalNote = 'Lossless edit target';
		const prefix = `option "operating_currency" "USD"\n2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n`;
		const transaction = `2025-01-01 * "Cafe" "${originalNote}" #groceries ^receipt-123 ; header-comment
  cashier_id: "lossless-edit-id"
  custom: "keep-custom-metadata"
  receipt: "receipt.pdf"
  ; transaction-comment
  Expenses:Food  12.50 USD ; food-posting-comment
    category: "lunch"
  Assets:Cash  -12.50 USD ; cash-posting-comment
    reference: "cash-receipt"
`;
		const neighbor = `
; untouched neighbor comment
2025-01-02 ! "Neighbor" "Untouched"
  cashier_id: "lossless-neighbor-id"
  Expenses:Food  3.00 USD
  Assets:Cash  -3.00 USD
`;
		const source = prefix + transaction + neighbor;
		const expected = prefix + transaction.replace(`"${originalNote}"`, `"${savedNote}"`) + neighbor;

		await expect
			.poll(() =>
				page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)
			)
			.toBe('activated');
		await writeLocalJournal(page, source);
		await page.reload();
		await expect(page.getByRole('main')).toContainText(originalNote);
		await expect
			.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
			.toBe(true);
		expect(await readLocalJournal(page)).toBe(source);

		await page.getByText(originalNote, { exact: false }).click();
		await expect(page).toHaveURL(/\/xact-actions$/);
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page).toHaveURL(/\/tx$/);
		await expect(page.getByTitle('Note', { exact: true })).toHaveValue(originalNote);
		if (savedNote !== originalNote) {
			await page.getByTitle('Note', { exact: true }).fill(savedNote);
		}
		if (rejectPostingEdit) {
			await page.getByTitle('Amount', { exact: true }).first().fill('15');
		}

		const saveRequests: string[] = [];
		const recordRequest = (request: Request) => {
			if (['fetch', 'xhr'].includes(request.resourceType())) {
				saveRequests.push(`${request.method()} ${request.url()}`);
			}
		};
		await context.setOffline(true);
		page.on('request', recordRequest);
		await page.locator('button.fixed').click();
		if (rejectPostingEdit) {
			await expect(page.locator('#toast-container .alert-error')).toContainText(
				'no changes were saved'
			);
			await expect(page).toHaveURL(/\/tx$/);
			await expect(page.getByTitle('Note', { exact: true })).toHaveValue(savedNote);
			await expect(page.getByTitle('Amount', { exact: true }).first()).toHaveValue('15');
			expect(await readLocalJournal(page)).toBe(source);
			page.off('request', recordRequest);
			expect(saveRequests).toEqual([]);
			await context.setOffline(false);
			expect(browserErrors).toEqual([]);
			return;
		}
		await expect(page).toHaveURL(/\/xact-actions$/);
		await expect(page.locator('body')).toContainText(savedNote);
		page.off('request', recordRequest);
		expect(saveRequests).toEqual([]);
		const saved = await readLocalJournal(page);
		expect(saved).toBe(expected);
		expect(saved.endsWith(neighbor)).toBe(true);

		await page.getByRole('link', { name: 'Journal', exact: true }).click();
		await expect(page).toHaveURL(/\/journal$/);
		await page.reload();
		await expect(page.getByRole('main')).toContainText(savedNote);
		await expect(page.getByRole('main')).toContainText('Untouched');
		expect(await readLocalJournal(page)).toBe(expected);
		await page.getByText(savedNote, { exact: false }).click();
		await page.getByRole('button', { name: 'Edit', exact: true }).click();
		await expect(page).toHaveURL(/\/tx$/);
		await expect(page.getByTitle('Note', { exact: true })).toHaveValue(savedNote);
		expect(await readLocalJournal(page)).toBe(expected);
		await context.setOffline(false);
		expect(browserErrors).toEqual([]);
	});
}

for (const richSource of [false, true]) {
	for (const scenario of ['changed first save', 'no-op first save', 'stale second save']) {
		test(`immediate repeat edit: ${richSource ? 'metadata-rich' : 'bare transaction-only'} source, ${scenario}`, async ({
			page
		}) => {
			const offlineToast = page.locator('.toast').filter({ hasText: 'App ready to work offline' });
			await page.addLocatorHandler(offlineToast, async (toast) => {
				await toast.getByRole('button', { name: 'Close', exact: true }).click();
			});
			const browserErrors = await openReadyJournal(page);
			const originalNote = 'Repeat edit target';
			const prefix = richSource
				? `option "operating_currency" "USD"\n2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n`
				: '';
			const before = `2025-01-01 ! "Before" "Untouched before"\n  Expenses:Food  1.00 USD\n  Assets:Cash  -1.00 USD\n\n`;
			const transaction = richSource
				? `2025-01-02 * "Cafe" "${originalNote}" #groceries ^receipt-29 ; header-comment
  cashier_id: "repeat-edit-id"
  custom: "keep-custom-metadata"
  ; transaction-comment
  Expenses:Food  12.50 USD ; food-comment
    category: "lunch"
  Assets:Cash  -12.50 USD
`
				: `2025-01-02 * "Cafe" "${originalNote}"\n  Expenses:Food  12.50 USD\n  Assets:Cash  -12.50 USD\n`;
			const after = `\n; untouched neighbor comment\n2025-01-03 ! "After" "Untouched after"\n  Expenses:Food  3.00 USD\n  Assets:Cash  -3.00 USD\n`;
			const source = prefix + before + transaction + after;
			await writeLocalJournal(page, source);
			await page.reload();
			await expect(page.getByRole('main')).toContainText(originalNote);
			await page.getByText(originalNote, { exact: false }).click();
			await expect(page).toHaveURL(/\/xact-actions$/);

			let expected = source;
			let previousNote = originalNote;
			const firstNote = scenario === 'no-op first save' ? originalNote : 'First saved correction';
			const notes = [firstNote, 'Second saved correction with a longer note'];
			for (const [index, note] of notes.entries()) {
				// Do not reselect from Journal: that would repair the lost source span from issue #29.
				await page.getByRole('button', { name: 'Edit', exact: true }).click();
				await expect(page).toHaveURL(/\/tx$/);
				await expect(page.getByTitle('Note', { exact: true })).toHaveValue(previousNote);
				if (note !== previousNote) await page.getByTitle('Note', { exact: true }).fill(note);

				const rejectSave = index === 1 && scenario === 'stale second save';
				const writes: string[] = [];
				if (rejectSave) {
					expected =
						'; concurrent journal change\n' +
						expected.replace(`"${previousNote}"`, '"Concurrent correction"');
					await writeLocalJournal(page, expected);
					await page.exposeFunction('recordRejectedSaveWrite', (write: string) =>
						writes.push(write)
					);
					await page.evaluate(() => {
						const record = (write: string) =>
							(
								window as unknown as { recordRejectedSaveWrite: (write: string) => Promise<void> }
							).recordRejectedSaveWrite(write);
						const original = FileSystemFileHandle.prototype.createWritable;
						FileSystemFileHandle.prototype.createWritable = function (...args) {
							void record(`OPFS.${this.name}.createWritable`);
							return original.apply(this, args);
						};
						for (const method of ['add', 'put', 'delete', 'clear'] as const) {
							const original = IDBObjectStore.prototype[method];
							Object.defineProperty(IDBObjectStore.prototype, method, {
								configurable: true,
								value: function (this: IDBObjectStore, ...args: unknown[]) {
									void record(`IndexedDB.${this.name}.${method}`);
									return Reflect.apply(original, this, args);
								}
							});
						}
					});
				}

				await page.locator('.navbar .dropdown > button').click();
				await page.getByRole('menu').getByRole('button', { name: 'Save', exact: true }).click();
				if (rejectSave) {
					await expect(page.locator('#toast-container .alert-error')).toContainText(
						'Reload the Journal'
					);
					await expect(page).toHaveURL(/\/tx$/);
					await expect(page.getByTitle('Note', { exact: true })).toHaveValue(note);
					expect(await readLocalJournal(page)).toBe(expected);
					expect(writes).toEqual([]);
				} else {
					await expect(page).toHaveURL(/\/xact-actions$/);
					await expect(page.locator('main').last()).toContainText(note);
					expected = expected.replace(`"${previousNote}"`, `"${note}"`);
					expect(await readLocalJournal(page)).toBe(expected);
				}
				previousNote = note;
			}
			const saved = await readLocalJournal(page);
			expect(saved.match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(3);
			expect(saved.match(/^[ \t]+cashier_id:.*$/gm) ?? []).toEqual(
				richSource ? ['  cashier_id: "repeat-edit-id"'] : []
			);
			if (scenario !== 'stale second save') {
				await page.getByRole('link', { name: 'Home', exact: true }).click();
				await expect(page).toHaveURL(/\/$/);
				await page.getByRole('button', { name: 'New transaction', exact: true }).click();
				await expect(page).toHaveURL(/\/tx$/);
				await page.getByTitle('Note', { exact: true }).fill('New entry after editing');
				await page.locator('button.fixed').click();
				await expect(page).toHaveURL(/\/$/);
				const withNewEntry = await readLocalJournal(page);
				expect(withNewEntry.startsWith(saved.trimEnd() + '\n\n')).toBe(true);
				expect(withNewEntry.match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(4);
				expect(withNewEntry).toContain('New entry after editing');
			}
			expect(browserErrors).toEqual([]);
		});
	}
}

for (const { flag, editedNote, save, name } of [
	{ flag: '*', editedNote: 'Edited duplicate', save: true, name: 'save with changes' },
	{ flag: '*', editedNote: undefined, save: true, name: 'save unchanged' },
	{ flag: '!', editedNote: undefined, save: true, name: 'save an incomplete copy' },
	{ flag: '*', editedNote: 'Discarded duplicate', save: false, name: 'leave without saving' }
]) {
	test(`Duplicate: ${name}`, async ({ page }) => {
		const note = 'Original to duplicate';
		const original = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash USD
2000-01-01 open Expenses:Food USD
pushtag #travel
2025-01-01 ${flag} "Cafe" "${note}" #trip ^invoice ; keep original source
  cashier_id: "original-duplicate-id"
  Expenses:Food  12.50 USD
  Assets:Cash  -12.50 USD
poptag #travel
`;
		await openReadyJournal(page);
		await writeLocalJournal(page, original);
		await page.reload();
		const originalNote = page.getByText(`; ${note}`, { exact: true });
		await originalNote.click();
		await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
		await expect(page).toHaveURL(/\/tx$/);
		await expect(page.getByTitle('Note', { exact: true })).toHaveValue(note);
		expect(await readLocalJournal(page)).toBe(original);

		if (editedNote) await page.getByTitle('Note', { exact: true }).fill(editedNote);
		if (save) await page.getByRole('button', { name: 'Save', exact: true }).click();
		else await page.goBack();
		await expect(page).toHaveURL(/\/journal$/);
		await expect(originalNote).toHaveCount(save && !editedNote ? 2 : 1);

		const saved = await readLocalJournal(page);
		if (!save) {
			expect(saved).toBe(original);
			return;
		}
		expect(saved.startsWith(original)).toBe(true);
		expect(saved.match(/^\d{4}-\d{2}-\d{2} [*!] /gm)).toHaveLength(2);
		const copy = saved.slice(original.length);
		const [header] = copy.trimStart().split('\n');
		const start = `2025-01-01 ${flag} "Cafe" "${editedNote ?? note}" `;
		expect(header.startsWith(start)).toBe(true);
		expect(header.slice(start.length).split(' ').sort()).toEqual(['#travel', '#trip', '^invoice']);
		expect(copy).not.toContain('cashier_id:');
		expect(copy).toContain('Expenses:Food  12.50 USD');
		expect(copy).toContain('Assets:Cash  -12.50 USD');
		await page.reload();
		await expect(page.getByText(`; ${editedNote ?? note}`, { exact: true })).toHaveCount(
			editedNote ? 1 : 2
		);
		expect(await readLocalJournal(page)).toBe(saved);
	});
}

test('Duplicate refuses a purchase whose lot cost cannot be preserved', async ({ page }) => {
	const source = `option "operating_currency" "EUR"
2000-01-01 open Assets:Investments:Fund FUND
2000-01-01 open Assets:Cash EUR
2025-01-01 * "Broker" "Buy fund with lot cost"
  cashier_id: "fund-purchase-id"
  Assets:Investments:Fund  1 FUND {10 EUR}
  Assets:Cash            -10 EUR
`;
	await openReadyJournal(page);
	await writeLocalJournal(page, source);
	await page.reload();
	const note = page.getByText('; Buy fund with lot cost', { exact: true });
	await note.click();
	await expect(page).toHaveURL(/\/xact-actions$/);
	await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
	await expect(page.locator('#toast-container .alert-error')).toContainText('lot costs');
	await expect(page).toHaveURL(/\/xact-actions$/);
	expect(await readLocalJournal(page)).toBe(source);
	await page.goBack();
	await expect(note).toHaveCount(1);
});

test('Home distinguishes incomplete entries and refreshes its recent entries after local save', async ({
	page
}) => {
	await page.goto('/');
	const main = page.getByRole('main');
	await expect(main.getByText('The device journal is empty')).toBeVisible();
	await writeLocalJournal(
		page,
		`option "operating_currency" "USD"
2000-01-01 open Assets:Cash USD
2000-01-01 open Expenses:Food USD
2025-01-01 * "Completed cafe"
  Expenses:Food  1 USD
  Assets:Cash  -1 USD
2025-01-02 ! "Incomplete cafe"
  Expenses:Food  2 USD
  Assets:Cash  -2 USD
`
	);
	await page.reload();
	await expect(main.getByText('Completed cafe')).toBeVisible();
	await expect(main.getByText('Incomplete cafe')).toBeVisible();
	await expect(main.getByRole('img', { name: 'Incomplete entry' })).toHaveCount(1);
	await expect(main.getByText('Incomplete cafe').getByRole('img')).toHaveAttribute(
		'aria-label',
		'Incomplete entry'
	);

	await main.getByRole('button', { name: 'New transaction' }).click();
	await expect(page).toHaveURL('/tx');
	await page.getByTitle('Note', { exact: true }).fill('New Home cafe');
	await main.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page).toHaveURL('/');
	await expect(main.getByText('New Home cafe')).toBeVisible();
});

test('saves a journal entry offline and persists it after reload', async ({ page, context }) => {
	const browserErrors = await openReadyJournal(page);
	await waitForOfflineControl(page);
	const note = `Offline UI ${Date.now()}`;
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/tx$/);
	await expect(page.getByTitle('Note')).toBeVisible();
	await page.getByTitle('Note').fill(note);
	await context.setOffline(true);
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.locator('body')).toContainText(note);
	const source = await readLocalJournal(page);
	expect(source).toContain(note);
	expect(source).toMatch(new RegExp(`!\\s+"${note}"`));

	await context.setOffline(false);
	await page.reload();
	await expect(page.locator('body')).toContainText(note);
	const reloadedSource = await readLocalJournal(page);
	expect(reloadedSource).toBe(source);

	if (browserErrors.length) throw new Error(browserErrors.join('\n'));
});
