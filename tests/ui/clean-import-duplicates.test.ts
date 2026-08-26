import { expect, test } from '@playwright/test';

const ledger = [
	'option "operating_currency" "USD"',
	'2026-01-01 open Assets:Cash USD',
	'2026-01-01 open Expenses:Food USD',
	'',
	'2026-08-26 * "Server only" "One directive"',
	'  Assets:Cash   -5 USD',
	'  Expenses:Food  2 USD',
	'  Expenses:Food  3 USD'
].join('\n');

test('clean import shows a server transaction once across repeated sync', async ({ page }) => {
	await page.route('**/api**', async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith('/infrastructure') && url.searchParams.get('file_path') === 'main.bean') {
			await route.fulfill({ json: { content: ledger } });
			return;
		}
		await route.fulfill({ status: 500, body: `Unexpected API request: ${url}` });
	});

	await page.goto('/sync');
	await page.getByLabel('Data source').selectOption('beancount');
	await page.getByLabel('Cashier Server URL').fill(`${new URL(page.url()).origin}/api`);
	await page.getByLabel('Remote root book file').fill('main.bean');
	await page.getByRole('checkbox', { name: 'Ledger files to OPFS' }).check();

	const readOpfsState = () =>
		page.evaluate(async () => {
			const root = await navigator.storage.getDirectory();
			const files: Record<string, string> = {};
			const walk = async (directory: FileSystemDirectoryHandle, prefix = '') => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				for await (const [name, handle] of (directory as any).entries()) {
					const path = prefix ? `${prefix}/${name}` : name;
					if (handle.kind === 'directory') {
						await walk(handle as FileSystemDirectoryHandle, path);
					} else {
						files[path] = await (await handle.getFile()).text();
					}
				}
			};
			await walk(root);
			return files;
		});

	for (let attempt = 0; attempt < 2; attempt++) {
		await page.getByRole('button', { name: 'Synchronize' }).click();
		await expect(page.getByTestId('sync-parse-result')).toHaveText('ok');
		const opfsBeforeNavigation = await readOpfsState();
		const mainPath = Object.keys(opfsBeforeNavigation).find((path) => path.endsWith('main.bean'));
		const cashierPath = Object.keys(opfsBeforeNavigation).find((path) => path.endsWith('cashier.bean'));
		expect({ files: Object.keys(opfsBeforeNavigation), mainPath }).toEqual(
			expect.objectContaining({ mainPath: expect.any(String) })
		);
		expect(opfsBeforeNavigation[mainPath!]).toContain('Server only');
		expect(cashierPath).toBeDefined();
		expect(opfsBeforeNavigation[cashierPath!]).toBe('');

		await page.goto('/accounts/account-xacts/Expenses%3AFood');
		const opfsAfterNavigation = await readOpfsState();
		expect(opfsAfterNavigation[mainPath!]).toContain('Server only');
		await expect(page.getByText(/Server only.*One directive/)).toHaveCount(1);
		await page.goto('/sync');
	}
});
