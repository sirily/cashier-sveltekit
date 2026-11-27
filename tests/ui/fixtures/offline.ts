import { expect, type Page } from '@playwright/test';

/** A first installation does not control the page that registered the worker. */
export async function waitForOfflineControl(page: Page) {
	if (await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) return;
	await page.waitForFunction(
		async () => (await navigator.serviceWorker.ready).active?.state === 'activated'
	);
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true);
}
