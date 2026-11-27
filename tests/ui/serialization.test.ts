import { expect, test } from '@playwright/test';

test('standalone Serialization retains explicit load, cache and reset actions', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	await page.goto('/tools/serialization');
	const main = page.getByRole('main');
	await main.getByRole('button', { name: 'Load', exact: true }).click();
	await expect(main.getByText(/Ledger loaded/)).toBeVisible();
	await main.getByRole('button', { name: 'Serialize → OPFS', exact: true }).click();
	await expect(main.getByText(/Serialized [\d,]+ bytes/)).toBeVisible();
	await main.getByRole('button', { name: 'Reset instance', exact: true }).click();
	await expect(main.getByText('Ledger not loaded', { exact: true })).toBeVisible();
	await main.getByRole('button', { name: 'Deserialize ← OPFS', exact: true }).click();
	await expect(main.getByText(/Restored from cache .*Hash matches/)).toBeVisible();
	await main.getByRole('button', { name: 'Delete cache', exact: true }).click();
	await expect(main.getByText('Cache deleted and ledger instance freed.')).toBeVisible();
	await expect(
		main.getByRole('button', { name: 'Deserialize ← OPFS', exact: true })
	).toBeDisabled();
});
