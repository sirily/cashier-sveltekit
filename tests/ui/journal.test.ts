import { expect, test, type Page } from '@playwright/test';

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

test('edits an existing local transaction and survives journal reload', async ({ page }) => {
	const browserErrors = await openReadyJournal(page);
	const originalNote = `UI create ${Date.now()}`;
	const editedNote = `UI edit ${Date.now()}`;
	const book = `option "operating_currency" "USD"\n2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n2025-01-01 * "Cafe" "${originalNote}"\n  Expenses:Food  12.50 USD\n  Assets:Cash  -12.50 USD\n`;

	await writeLocalJournal(page, book);
	await page.reload();
	await expect(page.locator('body')).toContainText(originalNote);

	await page.getByText(originalNote, { exact: false }).click();
	await expect(page).toHaveURL(/\/xact-actions$/);
	await page.getByRole('button', { name: 'Edit' }).click();
	await expect(page).toHaveURL(/\/tx$/);
	await page.getByTitle('Note').fill(editedNote);
	await page.locator('button.fixed').click();
	await expect(page).toHaveURL(/\/xact-actions$/);
	await expect(page.locator('body')).toContainText(editedNote);

	await page.getByRole('link', { name: 'Journal' }).click();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByRole('main')).toContainText(editedNote);
	await expect(page.getByRole('main')).not.toContainText(originalNote);
	await page.reload();
	await expect(page.locator('body')).toContainText(editedNote);
	await expect(page.locator('body')).not.toContainText(originalNote);
	const source = await readLocalJournal(page);
	expect(source).toContain(editedNote);
	expect(source.match(new RegExp(editedNote, 'g'))).toHaveLength(1);
	expect(source).not.toContain(originalNote);
	expect(source).toContain('2000-01-01 open Assets:Cash USD');
	expect(source).toContain('2000-01-01 open Expenses:Food USD');
	expect(source).toContain('Expenses:Food  12.5 USD');
	expect(source).toContain('Assets:Cash  -12.5 USD');
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
