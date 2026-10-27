import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import path from 'node:path';

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

		const generatedApp = await readFile(
			path.resolve('.svelte-kit/generated/client-optimized/app.js'),
			'utf8'
		);
		const calculatorRoute = generatedApp.match(/"\/calculator": \[([0-9]+)\]/);
		expect(calculatorRoute).not.toBeNull();
		const calculatorNode = calculatorRoute![1];
		const staleChunkName = `${calculatorNode}.`;
		let staleChunkFailed = false;

		await page.route(`**/_app/immutable/nodes/${staleChunkName}*.js`, async (route) => {
			if (!staleChunkFailed) {
				staleChunkFailed = true;
				await route.fulfill({ status: 404, body: 'stale deployment chunk' });
				return;
			}
			await route.continue();
		});

		await page.getByRole('complementary').getByText('Utilities', { exact: true }).click();
		await expect(page.getByRole('link', { name: 'Calculator' })).toBeVisible();
		await page.getByRole('link', { name: 'Calculator' }).click();
		await expect(page).toHaveURL(/\/calculator$/);
		await expect(page.getByRole('button', { name: 'AC' })).toBeVisible();
		expect(staleChunkFailed).toBe(true);
		expect(documentNavigations.some((url) => new URL(url).pathname === '/calculator')).toBe(true);
	} finally {
		await context.close();
	}
});
