import { expect, test } from '@playwright/test';

test('home page loads the Cashier app shell', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('body')).toContainText('Home Settings');
});
