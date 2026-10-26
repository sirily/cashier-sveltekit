import type { Workbox } from 'workbox-window';

export type UpdateCheckResult = 'available' | 'latest' | 'unavailable' | 'error';

export async function getInstalledBuildTimestamp(): Promise<string | undefined> {
	await initPwa();
	if (typeof navigator === 'undefined') return undefined;
	const worker = navigator.serviceWorker?.controller;
	if (!worker) return undefined;

	return new Promise((resolve) => {
		const channel = new MessageChannel();
		let settled = false;
		const finish = (timestamp: string | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			channel.port1.close();
			channel.port2.close();
			resolve(timestamp);
		};
		const timeout = setTimeout(() => finish(undefined), 2000);
		channel.port1.onmessage = (event) =>
			finish(typeof event.data === 'string' ? event.data : undefined);
		worker.postMessage({ type: 'GET_BUILD_TIMESTAMP' }, [channel.port2]);
	});
}

export const needRefresh = $state({ value: false });
export const offlineReady = $state({ value: false });

let registration: ServiceWorkerRegistration | undefined;
let workbox: Workbox | undefined;
let initPromise: Promise<void> | undefined;

export function initPwa(): Promise<void> {
	initPromise ??= (async () => {
		if (import.meta.env.DEV || typeof navigator === 'undefined' || !('serviceWorker' in navigator))
			return;

		const { Workbox } = await import('workbox-window');
		const wb = new Workbox('/sw.js');
		workbox = wb;
		wb.addEventListener('waiting', () => (needRefresh.value = true));
		wb.addEventListener('activated', (event) => {
			if (!event.isUpdate) offlineReady.value = true;
		});
		try {
			registration = await wb.register();
		} catch (error) {
			console.error('Service worker registration failed:', error);
		}
	})();
	return initPromise;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
	await initPwa();
	if (!registration) return 'unavailable';
	if (needRefresh.value) return 'available';

	try {
		await registration.update();
		const installing = registration.installing;
		if (installing) {
			await new Promise<void>((resolve) => {
				const onChange = () => {
					if (installing.state === 'installing') return;
					installing.removeEventListener('statechange', onChange);
					resolve();
				};
				installing.addEventListener('statechange', onChange);
				onChange();
			});
			if (installing.state === 'redundant') return 'error';
		}
		if (registration.waiting) {
			needRefresh.value = true;
			return 'available';
		}
		return 'latest';
	} catch (error) {
		console.error('Service worker update check failed:', error);
		return 'error';
	}
}

export async function updateApp(): Promise<void> {
	await initPwa();
	if (!workbox || typeof navigator === 'undefined') return;
	let reloaded = false;
	let fallbackTimer: ReturnType<typeof setTimeout>;
	const reloadOnce = () => {
		if (reloaded) return;
		reloaded = true;
		navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce);
		clearTimeout(fallbackTimer);
		window.location.reload();
	};

	navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
	fallbackTimer = setTimeout(reloadOnce, 3000);
	workbox.messageSkipWaiting();
	needRefresh.value = false;
}
