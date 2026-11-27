// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Layout from '../src/routes/+layout.svelte';

const mocks = vi.hoisted(() => ({
	initialize: vi.fn(),
	load: vi.fn(),
	error: vi.fn(),
	pwa: vi.fn(),
	observe: vi.fn(),
	stop: vi.fn()
}));
vi.mock('#lib/services/bookSelectionEvents', () => ({
	observeBookSelectionChanges: mocks.observe
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
	mocks.observe.mockReturnValue(mocks.stop);
	mocks.initialize.mockResolvedValue(undefined);
	mocks.load.mockResolvedValue(undefined);
});
afterEach(cleanup);

function mount() {
	return render(Layout, {
		children: createRawSnippet(() => ({ render: () => '<p>App content</p>' }))
	});
}

test('startup journal storage denial is handled and notified, not an unhandled mount rejection', async () => {
	const denied = new DOMException('Journal OPFS access denied', 'NotAllowedError');
	mocks.initialize.mockRejectedValueOnce(denied);
	const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
	mount();
	await waitFor(() => {
		expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Journal OPFS access denied'));
		expect(mocks.error).toHaveBeenCalledWith('Failed to initialize the engine.');
	});
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
	const view = mount();
	await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
	expect(mocks.error).not.toHaveBeenCalled();
	expect(mocks.observe).toHaveBeenCalledOnce();
	view.unmount();
	expect(mocks.stop).toHaveBeenCalledOnce();
});
