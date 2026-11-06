import { expect, type Page } from '@playwright/test';

/** Follow a real drawer link only after its expanding section has settled. */
export async function navigateFromDrawer(page: Page, name: string): Promise<void> {
	const link = page.locator('aside').getByRole('link', { name, exact: true, includeHidden: true });
	const details = link.locator('xpath=ancestor::details');
	if (await details.count()) {
		if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
			await details.locator('summary').click();
		}
		// Playwright's link box can be stable while its expanding ancestor still moves
		// the pointer target. Flush styles and wait for the entire section, not the link.
		await details.evaluate(async (element) => {
			await Promise.all(
				element.getAnimations({ subtree: true }).map((animation) => animation.finished)
			);
		});
	}
	const href = await link.getAttribute('href');
	expect(href, `Drawer link ${name} must have a destination`).toBeTruthy();
	const destination = new URL(href!, page.url()).href;
	await link.click();
	await expect(page, `Drawer link ${name} must reach ${destination}`).toHaveURL(destination);
}
