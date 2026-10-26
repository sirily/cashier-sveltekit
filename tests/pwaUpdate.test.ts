import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	workbox: undefined as MockWorkbox | undefined,
	reload: vi.fn()
}));

type Listener = (...args: unknown[]) => void;
type ServiceWorkerListener = { listener: Listener; once: boolean };

class MockWorkbox {
	listeners = new Map<string, Listener[]>();
	register = vi.fn(async () => registration);
	messageSkipWaiting = vi.fn();
	addEventListener = vi.fn((type: string, listener: Listener) => {
		this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
	});
	emit(type: string, event: unknown = {}) {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

const registration = {
	update: vi.fn(),
	waiting: { state: 'installed' as const },
	installing: null
};
const serviceWorkerListeners = new Map<string, ServiceWorkerListener[]>();

function setupServiceWorker() {
	const serviceWorker = {
		addEventListener: vi.fn(
			(type: string, listener: Listener, options?: AddEventListenerOptions) => {
				serviceWorkerListeners.set(type, [
					...(serviceWorkerListeners.get(type) ?? []),
					{ listener, once: options?.once ?? false }
				]);
			}
		),
		removeEventListener: vi.fn((type: string, listener: Listener) => {
			serviceWorkerListeners.set(
				type,
				(serviceWorkerListeners.get(type) ?? []).filter((entry) => entry.listener !== listener)
			);
		}),
		dispatch: (type: string) => {
			const entries = [...(serviceWorkerListeners.get(type) ?? [])];
			for (const entry of entries) {
				entry.listener(new Event(type));
				if (entry.once) serviceWorker.removeEventListener(type, entry.listener);
			}
		}
	};
	vi.stubEnv('DEV', false);
	vi.useFakeTimers();
	vi.stubGlobal('navigator', { serviceWorker });
	vi.stubGlobal('window', { location: { reload: mocks.reload } });
	return serviceWorker;
}

async function setupPwa() {
	const workbox = new MockWorkbox();
	mocks.workbox = workbox;
	const serviceWorker = setupServiceWorker();
	const pwa = await import('../src/lib/services/pwaUpdate.svelte');
	await pwa.initPwa();
	return { ...pwa, workbox, serviceWorker };
}

vi.mock('workbox-window', () => ({
	Workbox: class {
		constructor() {
			if (!mocks.workbox) throw new Error('MockWorkbox not initialized');
			return mocks.workbox;
		}
	}
}));

afterEach(() => {
	try {
		vi.clearAllTimers();
		vi.resetModules();
		vi.clearAllMocks();
		serviceWorkerListeners.clear();
		registration.update.mockReset();
		registration.waiting = { state: 'installed' };
		registration.installing = null;
		mocks.workbox = undefined;
	} finally {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	}
});

describe('PWA update lifecycle', () => {
	it('does not activate a waiting worker until the user requests Reload', async () => {
		const { needRefresh, updateApp, workbox } = await setupPwa();

		workbox.emit('waiting');
		expect(needRefresh.value).toBe(true);
		expect(registration.waiting?.state).toBe('installed');
		expect(workbox.messageSkipWaiting).not.toHaveBeenCalled();
		expect(mocks.reload).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);

		await updateApp();
		expect(workbox.messageSkipWaiting).toHaveBeenCalledOnce();
		expect(needRefresh.value).toBe(false);
		expect(mocks.reload).not.toHaveBeenCalled();
	});

	it('reloads once on controllerchange and does not reload again when the fallback timer expires', async () => {
		const { updateApp, serviceWorker } = await setupPwa();

		await updateApp();
		serviceWorker.dispatch('controllerchange');
		expect(mocks.reload).toHaveBeenCalledOnce();
		expect(serviceWorker.removeEventListener).toHaveBeenCalledWith(
			'controllerchange',
			expect.any(Function)
		);

		await vi.advanceTimersByTimeAsync(3000);
		expect(mocks.reload).toHaveBeenCalledOnce();
	});

	it('reloads once on the fallback timer and ignores a later controllerchange', async () => {
		const { updateApp, serviceWorker } = await setupPwa();

		await updateApp();
		await vi.advanceTimersByTimeAsync(3000);
		expect(mocks.reload).toHaveBeenCalledOnce();

		serviceWorker.dispatch('controllerchange');
		expect(mocks.reload).toHaveBeenCalledOnce();
		expect(serviceWorker.removeEventListener).toHaveBeenCalledWith(
			'controllerchange',
			expect.any(Function)
		);
	});
});
