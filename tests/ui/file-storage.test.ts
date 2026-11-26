import { expect, test } from '@playwright/test';

test('File Storage opens nested files without changing them and keeps confirmed create/delete actions', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle('books', { create: true });
		const file = await dir.getFileHandle('Notes.txt', { create: true });
		const writer = await file.createWritable();
		await writer.write('Original nested file');
		await writer.close();
	});
	await page.goto('/opfs');
	const main = page.getByRole('main');
	await main.getByRole('button', { name: 'books', exact: true }).click();
	await main.getByRole('button', { name: 'Notes.txt', exact: true }).click();
	await expect(page).toHaveURL('/opfs/edit-file?file=books%2FNotes.txt');
	await expect(main.locator('textarea')).toHaveValue('Original nested file');
	await expect(main.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
	await page.goBack();

	await main.locator('.navbar .dropdown > button').click();
	await main.getByRole('button', { name: 'New File', exact: true }).click();
	await main.getByPlaceholder('Enter filename...').fill('new.txt');
	await main.getByRole('button', { name: 'Create', exact: true }).click();
	const remove = main.getByRole('button', { name: 'Delete new.txt', exact: true });
	await remove.click();
	await main.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(remove).toBeVisible();
	await remove.click();
	await main.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(remove).toHaveCount(0);
	const result = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const dir = await root.getDirectoryHandle('books');
		const file = await (await dir.getFileHandle('Notes.txt')).getFile();
		return {
			contents: await file.text(),
			dbs: (await indexedDB.databases()).map(({ name }) => name)
		};
	});
	expect(result.contents).toBe('Original nested file');
	expect(result.dbs).not.toContain('cashier-import-manifest');
});
