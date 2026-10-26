import { expect, test } from '@playwright/test';

test('opens the supported export routes', async ({ page }) => {
	await page.goto('/export/journal');
	await expect(page).toHaveURL(/\/export\/journal$/);
	await expect(page.getByText('Export journal', { exact: true })).toBeVisible();

	await page.goto('/export/scheduled');
	await expect(page).toHaveURL(/\/export\/scheduled$/);
	await expect(page.getByText('Export scheduled', { exact: true })).toBeVisible();
});

test('returns not found for an unsupported export type', async ({ page }) => {
	const response = await page.goto('/export/unsupported');

	expect(response?.status()).toBe(404);
	await expect(page.getByText('Not Found')).toBeVisible();
});
