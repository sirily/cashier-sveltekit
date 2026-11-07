import { expect, test } from '@playwright/test';
import { PwaPreviewProxy } from './fixtures/pwa-server';

const book = (note: string) =>
	`option "operating_currency" "USD"\n2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n2025-01-01 * "Cafe" "${note}"\n  Expenses:Food  12.50 USD\n  Assets:Cash  -12.50 USD\n`;

async function readLocalBook(page: import('@playwright/test').Page) {
	return page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const file = await root.getFileHandle('cashier.bean');
		return (await file.getFile()).text();
	});
}

test('production service worker controls the app, serves the journal offline, and does not cache API responses', async ({
	page,
	context
}) => {
	const apiUrl = new URL('/api/pwa-test', 'http://127.0.0.1:4173').href;
	let serveApi = true;
	await context.route(apiUrl, async (route) => {
		if (serveApi) await route.fulfill({ json: { ok: true } });
		else await route.abort('failed');
	});

	await page.goto('/');
	await expect(page.getByText('The device journal is empty')).toBeVisible();
	const note = `PWA offline ${Date.now()}`;
	await page.evaluate(async (content) => {
		const root = await navigator.storage.getDirectory();
		const file = await root.getFileHandle('cashier.bean', { create: true });
		const writer = await file.createWritable();
		await writer.write(content);
		await writer.close();
	}, book(note));
	await page.goto('/journal');
	await expect(page).toHaveURL(/\/journal$/);
	const initialWorker = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		return registration.active?.scriptURL;
	});
	expect(initialWorker).toContain('/sw.js');
	await expect
		.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
		.toBe('activated');
	await page.reload();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByRole('main')).toContainText(note);
	await expect
		.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
		.toBe(true);

	const apiResponse = await page.evaluate(async (url) => {
		const response = await fetch(url, {
			headers: { Authorization: 'Bearer pwa-test-token' }
		});
		return { status: response.status, body: await response.json() };
	}, apiUrl);
	expect(apiResponse).toEqual({ status: 200, body: { ok: true } });
	const cachedApiEntries = await page.evaluate(async (url) => {
		const cacheNames = await caches.keys();
		const entries = await Promise.all(
			cacheNames.map(async (name) => {
				const cache = await caches.open(name);
				return (await cache.keys()).map((request) => request.url).filter((entry) => entry === url);
			})
		);
		return entries.flat();
	}, apiUrl);
	expect(cachedApiEntries).toEqual([]);

	serveApi = false;
	await context.setOffline(true);
	const offlineApiResult = await page.evaluate(async (url) => {
		try {
			await fetch(url, { headers: { Authorization: 'Bearer pwa-test-token' } });
			return 'fulfilled';
		} catch {
			return 'rejected';
		}
	}, apiUrl);
	expect(offlineApiResult).toBe('rejected');
	await page.reload();
	await expect(page).toHaveURL(/\/journal$/);
	await expect(page.getByRole('main')).toContainText(note);
	await expect.poll(() => readLocalBook(page)).toBe(book(note));

	await context.setOffline(false);
});

test('real worker update waits for Reload and preserves the local journal through activation', async ({
	browser
}) => {
	const proxy = new PwaPreviewProxy();
	const origin = await proxy.start();
	const context = await browser.newContext({ baseURL: origin });
	const page = await context.newPage();
	const note = `PWA update ${Date.now()}`;
	const originalBook = book(note);

	try {
		await page.goto('/');
		await expect(page.getByText('The device journal is empty')).toBeVisible();
		await page.evaluate(async (content) => {
			const root = await navigator.storage.getDirectory();
			const file = await root.getFileHandle('cashier.bean', { create: true });
			const writer = await file.createWritable();
			await writer.write(content);
			await writer.close();

			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise<void>((resolve, reject) => {
				const transaction = db.transaction('settings', 'readwrite');
				transaction.objectStore('settings').put({
					key: 'syncApiToken',
					value: JSON.stringify('pwa-test-token')
				});
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
			db.close();
		}, originalBook);
		await page.goto('/journal');
		await expect(page).toHaveURL(/\/journal$/);
		await expect(page.getByRole('main')).toContainText(note);

		const initial = await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.ready;
			return registration.active?.scriptURL;
		});
		expect(initial).toBe(`${origin}/sw.js`);
		await expect
			.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
			.toBe('activated');
		await page.reload();
		await expect(page).toHaveURL(/\/journal$/);
		await expect(page.getByRole('main')).toContainText(note);
		await expect
			.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
			.toBe(true);

		const wrapperBaseline = await (await page.request.get(`${origin}/sw.js`)).text();
		const importBaseline = await (await page.request.get(`${origin}/service-worker.js`)).text();
		expect(importBaseline).toContain('// pwa-test-worker-baseline');
		proxy.setWorkerVersion('candidate-v2');
		const wrapperCandidate = await (await page.request.get(`${origin}/sw.js`)).text();
		const importCandidate = await (await page.request.get(`${origin}/service-worker.js`)).text();
		expect(wrapperCandidate).toBe(wrapperBaseline);
		expect(importCandidate).toContain('// pwa-test-worker-candidate-v2');
		expect(importCandidate).not.toBe(importBaseline);
		const updateResult = await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.getRegistration();
			if (!registration) throw new Error('Expected an existing /sw.js registration');
			await registration.update();
			return true;
		});
		expect(updateResult).toBe(true);

		await expect(page.getByText('New content available, click reload to update.')).toBeVisible();
		const waitingState = await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.getRegistration();
			return {
				activeState: registration?.active?.state,
				waitingState: registration?.waiting?.state,
				activeScript: registration?.active?.scriptURL,
				waitingScript: registration?.waiting?.scriptURL
			};
		});
		expect(waitingState.activeState).toBe('activated');
		expect(waitingState.waitingState).toBe('installed');
		expect(waitingState.activeScript).toBe(`${origin}/sw.js`);
		expect(waitingState.waitingScript).toBe(`${origin}/sw.js`);
		await expect(page).toHaveURL(/\/journal$/);
		expect(await readLocalBook(page)).toBe(originalBook);

		const reloaded = page.waitForEvent('load');
		await page.getByRole('button', { name: 'Reload' }).click();
		await reloaded;
		await expect(page).toHaveURL(/\/journal$/);
		await expect(page.getByRole('main')).toContainText(note);

		await expect
			.poll(() =>
				page.evaluate(async () => {
					const registration = await navigator.serviceWorker.getRegistration();
					return {
						activeState: registration?.active?.state,
						waiting: Boolean(registration?.waiting),
						controlled: navigator.serviceWorker.controller === registration?.active
					};
				})
			)
			.toEqual({ activeState: 'activated', waiting: false, controlled: true });
		const finalBook = await readLocalBook(page);
		expect(finalBook).toBe(originalBook);
		const savedSyncToken = await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('Cashier');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			const value = await new Promise<unknown>((resolve, reject) => {
				const request = db
					.transaction('settings', 'readonly')
					.objectStore('settings')
					.get('syncApiToken');
				request.onsuccess = () => resolve(request.result?.value);
				request.onerror = () => reject(request.error);
			});
			db.close();
			return value;
		});
		expect(savedSyncToken).toBe(JSON.stringify('pwa-test-token'));
	} finally {
		await proxy.close();
		await context.close().catch(() => undefined);
	}
});
