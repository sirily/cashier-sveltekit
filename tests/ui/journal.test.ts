import { expect, test, type Page, type Request } from '@playwright/test';

async function openReadyJournal(page: Page) {
	const browserErrors: string[] = [];
	page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
	page.on('console', (message) => {
		if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
	});

	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.getByRole('link', { name: 'Journal' }).click();
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
		expect(saved).toContain('Expenses:Food  12.5 USD');
		expect(saved).toContain('Assets:Cash  -12.5 USD');

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

test('saves a journal entry offline and persists it after reload', async ({ page, context }) => {
	const browserErrors = await openReadyJournal(page);
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
