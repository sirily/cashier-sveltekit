import { expect, test } from '@playwright/test';

test('serves the adapter-static fallback and PWA files with Caddy-compatible headers', async ({
	request
}) => {
	const fallback = await request.get('/missing-static-route');
	expect(fallback.status()).toBe(200);
	expect(await fallback.text()).toContain('<!doctype html>');
	expect(fallback.headers()['cache-control']).toBe('no-cache');

	for (const path of [
		'/export/unsupported',
		'/assetclass-detail/Foo.Bar',
		'/_app/immutable/missing.js'
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		expect(await response.text(), path).toContain('<!doctype html>');
	}

	const sw = await request.get('/sw.js');
	expect(sw.status()).toBe(200);
	expect(sw.headers()['content-type']).toContain('javascript');
	expect(await sw.text()).toContain('importScripts');
	expect(sw.headers()['cache-control']).toBe('no-cache');

	const serviceWorker = await request.get('/service-worker.js');
	expect(serviceWorker.status()).toBe(200);
	expect(serviceWorker.headers()['content-type']).toContain('javascript');
	expect(await serviceWorker.text()).toContain('SKIP_WAITING');
	expect(serviceWorker.headers()['cache-control']).toBe('no-cache');

	const manifest = await request.get('/manifest.webmanifest');
	expect(manifest.status()).toBe(200);
	expect(manifest.headers()['content-type']).toContain('json');
	const manifestBody = (await manifest.json()) as {
		name: string;
		id: string;
		start_url: string;
		scope: string;
		display: string;
		theme_color: string;
		icons: { src: string; sizes: string; type: string; purpose?: string }[];
	};
	expect(manifestBody).toMatchObject({
		name: 'Cashier',
		id: '/',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		theme_color: '#076461'
	});
	expect(manifestBody.icons).toHaveLength(14);
	expect(manifestBody.icons).toContainEqual({
		src: 'icons/maskable-icon-512.png',
		sizes: '512x512',
		type: 'image/png',
		purpose: 'maskable'
	});
	for (const icon of manifestBody.icons) {
		expect(icon.src).toMatch(/^icons\/[\w-]+\.png$/);
		expect(icon.type).toBe('image/png');
		const response = await request.get(`/${icon.src}`);
		expect(response.status(), icon.src).toBe(200);
		expect(response.headers()['content-type'], icon.src).toContain('image/png');
		const png = await response.body();
		expect([...png.subarray(0, 8)], icon.src).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.src).toBe(icon.sizes);
	}
	expect(manifest.headers()['cache-control']).toBe('no-cache');

	const version = await request.get('/_app/version.json');
	expect(version.status()).toBe(200);
	expect(version.headers()['content-type']).toContain('json');
	expect(typeof JSON.parse(await version.text()).version).toBe('string');
	expect(version.headers()['cache-control']).toBe('no-cache');

	const html = await request.get('/');
	const assetPath = (await html.text()).match(
		/(?:src|href)="([^"]*\/_app\/immutable\/[^"]+)"/
	)?.[1];
	expect(assetPath).toBeTruthy();
	const immutableAsset = await request.get(assetPath!);
	expect(immutableAsset.status()).toBe(200);
	expect(immutableAsset.headers()['content-type']).toContain('javascript');
	expect(await immutableAsset.text()).not.toContain('<!doctype html>');
	expect(immutableAsset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});

test('production CSS retains the default Cashier theme, Tailwind utilities and DaisyUI buttons', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.locator('body')).toContainText('Home Settings');

	const styles = await page.evaluate(() => {
		const utility = document.createElement('div');
		utility.className = 'bg-primary p-4';
		const button = document.createElement('button');
		button.className = 'btn btn-primary';
		const reference = document.createElement('div');
		reference.style.backgroundColor = '#076461';
		document.body.append(utility, button, reference);
		try {
			const theme = getComputedStyle(document.documentElement);
			const utilityStyle = getComputedStyle(utility);
			const buttonStyle = getComputedStyle(button);
			return {
				primary: theme.getPropertyValue('--color-primary').trim(),
				colorScheme: theme.colorScheme,
				padding: utilityStyle.paddingTop,
				background: utilityStyle.backgroundColor,
				buttonBackground: buttonStyle.backgroundColor,
				buttonDisplay: buttonStyle.display,
				expectedBackground: getComputedStyle(reference).backgroundColor
			};
		} finally {
			utility.remove();
			button.remove();
			reference.remove();
		}
	});

	expect(styles.primary).toBe('#076461');
	expect(styles.colorScheme).toBe('dark');
	expect(styles.padding).toBe('16px');
	expect(styles.background).toBe(styles.expectedBackground);
	expect(styles.buttonBackground).toBe(styles.expectedBackground);
	expect(styles.buttonDisplay).toBe('inline-flex');
});
