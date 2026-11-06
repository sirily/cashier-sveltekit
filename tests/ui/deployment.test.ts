import { expect, test } from '@playwright/test';

test('a stale lazy-loaded route recovers by navigating to the new deployment', async ({
	browser
}) => {
	const context = await browser.newContext({ serviceWorkers: 'block' });
	const page = await context.newPage();
	const documentNavigations: string[] = [];
	page.on('request', (request) => {
		if (request.isNavigationRequest()) documentNavigations.push(request.url());
	});

	try {
		await page.goto('/');
		await expect(page.getByText('The device journal is empty')).toBeVisible();
		const versionResponse = await page.request.get('/_app/version.json');
		expect(versionResponse.ok()).toBeTruthy();
		const { version } = (await versionResponse.json()) as { version: string };
		expect(version).not.toBe('static');
		await page.route('**/_app/version.json', (route) =>
			route.fulfill({ json: { version: `${version}-new-deployment` } })
		);

		await page.getByRole('complementary').getByText('Utilities', { exact: true }).click();
		const calculatorLink = page.getByRole('link', { name: 'Calculator' });
		await expect(calculatorLink).toBeVisible();
		await page.mouse.move(0, 0);

		let staleChunkFailed = 0;
		await page.route('**/_app/immutable/nodes/*.js', async (route) => {
			if (staleChunkFailed === 0) {
				staleChunkFailed += 1;
				await route.fulfill({ status: 404, body: 'stale deployment chunk' });
				return;
			}
			await route.continue();
		});

		await calculatorLink.click();
		await expect(page).toHaveURL(/\/calculator$/);
		await expect(page.getByRole('button', { name: 'AC' })).toBeVisible();
		expect(staleChunkFailed).toBeGreaterThan(0);
		expect(documentNavigations.some((url) => new URL(url).pathname === '/calculator')).toBe(true);
	} finally {
		await context.close();
	}
});
