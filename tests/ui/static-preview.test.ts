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
	expect(JSON.parse(await manifest.text()).name).toBe('Cashier');
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
