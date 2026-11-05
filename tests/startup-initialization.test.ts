// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Layout from '../src/routes/+layout.svelte';

const mocks = vi.hoisted(() => ({
	mounts: [] as Array<() => Promise<void>>,
	initialize: vi.fn(),
	load: vi.fn(),
	error: vi.fn(),
	pwa: vi.fn()
}));
vi.mock('svelte', async (importOriginal) => ({
	...(await importOriginal<typeof import('svelte')>()),
	onMount: (callback: () => Promise<void>) => {
		mocks.mounts.push(callback);
	}
}));
vi.mock('#lib/data/initializer', () => ({ ensureInitialized: mocks.initialize }));
vi.mock('#lib/services/ledgerWorkerClient', () => ({ default: { ensureLoaded: mocks.load } }));
vi.mock('#lib/utils/notifier', () => ({ default: { error: mocks.error } }));
vi.mock('#lib/services/pwaUpdate.svelte', () => ({
	initPwa: mocks.pwa,
	needRefresh: { value: false },
	offlineReady: { value: false }
}));
vi.mock('#lib/components/navigation.svelte', async () => ({
	default: (await import('#lib/components/Toolbar.svelte')).default
}));
vi.mock('#lib/data/mainStore', async () => ({
	drawerState: (await import('svelte/store')).writable(false)
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('svelte-gestures', () => ({ useSwipe: () => ({}) }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.mounts.length = 0;
	mocks.initialize.mockResolvedValue(undefined);
	mocks.load.mockResolvedValue(undefined);
});
afterEach(cleanup);

function mount() {
	render(Layout, { children: createRawSnippet(() => ({ render: () => '<p>App content</p>' })) });
	expect(mocks.mounts).toHaveLength(1);
	return mocks.mounts[0]();
}

test('startup journal storage denial is handled and notified, not an unhandled mount rejection', async () => {
	const denied = new DOMException('Journal OPFS access denied', 'NotAllowedError');
	mocks.initialize.mockRejectedValueOnce(denied);
	const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	await expect(mount()).resolves.toBeUndefined();
	expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Journal OPFS access denied'));
	expect(logged).toHaveBeenCalledWith('Failed to initialize FullLedgerService:', denied);
	expect(mocks.load).not.toHaveBeenCalled();
});

test('successful startup initializes durable journal storage before loading analysis', async () => {
	let initialized = false;
	mocks.initialize.mockImplementationOnce(async () => {
		initialized = true;
	});
	mocks.load.mockImplementationOnce(async () => {
		expect(initialized).toBe(true);
	});
	await expect(mount()).resolves.toBeUndefined();
	expect(mocks.load).toHaveBeenCalledTimes(1);
	expect(mocks.error).not.toHaveBeenCalled();
});
