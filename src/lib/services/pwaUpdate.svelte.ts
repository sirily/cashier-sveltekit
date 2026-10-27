import type { Workbox } from 'workbox-window';

export type UpdateCheckResult = 'available' | 'latest' | 'unavailable' | 'error';
type PwaInitResult = 'ready' | 'unavailable' | 'error';

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
let initPromise: Promise<PwaInitResult> | undefined;
let workboxListenersInstalled = false;

export function initPwa(): Promise<PwaInitResult> {
	if (!initPromise) {
		const attempt = Promise.resolve().then(async (): Promise<PwaInitResult> => {
			if (
				import.meta.env.DEV ||
				typeof navigator === 'undefined' ||
				!('serviceWorker' in navigator)
			)
				return 'unavailable';

			try {
				if (!workbox) {
					const { Workbox } = await import('workbox-window');
					workbox = new Workbox('/sw.js');
				}
				if (!workboxListenersInstalled) {
					workbox.addEventListener('waiting', () => (needRefresh.value = true));
					workbox.addEventListener('activated', (event) => {
						if (!event.isUpdate) offlineReady.value = true;
					});
					workboxListenersInstalled = true;
				}
				registration = await workbox.register();
				return 'ready';
			} catch (error) {
				console.error('Service worker initialization failed:', error);
				if (!workbox) registration = undefined;
				return 'error';
			}
		});
		const handled = attempt.then((result) => {
			if (result === 'error' && initPromise === handled) initPromise = undefined;
			return result;
		});
		initPromise = handled;
	}
	return initPromise;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
	const initResult = await initPwa();
	if (initResult === 'error') return 'error';
	if (initResult === 'unavailable') return 'unavailable';
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
	if ((await initPwa()) !== 'ready') return;
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
