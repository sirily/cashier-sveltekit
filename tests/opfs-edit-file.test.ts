// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { SvelteURL } from 'svelte/reactivity';
import { tick } from 'svelte';
import Page from '../src/routes/opfs/edit-file/+page.svelte';

const mocks = vi.hoisted(() => ({
	url: new URL('http://localhost/opfs/edit-file?file=books/main.bean'),
	refresh: vi.fn(),
	success: vi.fn(),
	error: vi.fn()
}));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return mocks.url;
		}
	}
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/ledgerWorkerClient', () => ({ default: { invalidate: mocks.refresh } }));
vi.mock('#lib/utils/notifier', () => ({
	default: { init: vi.fn(), success: mocks.success, error: mocks.error }
}));
vi.mock('#lib/data/mainStore', async () => ({
	drawerState: (await import('svelte/store')).writable(false)
}));

const original = '; original source €\n';
const changed = '; edited source ₽\n';
let source: string;
let failure: string | null;
let finishClose: (() => void) | undefined;
let holdClose: boolean;
let abort: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.resetAllMocks();
	mocks.url = new SvelteURL('http://localhost/opfs/edit-file?file=books/main.bean');
	mocks.refresh.mockResolvedValue(undefined);
	source = original;
	failure = null;
	finishClose = undefined;
	holdClose = false;
	abort = vi.fn().mockResolvedValue(undefined);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	const file = {
		async getFile() {
			return { text: async () => source };
		},
		async createWritable() {
			if (failure === 'stream') throw new Error('Denied at stream');
			let pending = source;
			return {
				async write(data: Uint8Array) {
					if (failure === 'write') throw new Error('Denied at write');
					pending = new TextDecoder().decode(data);
				},
				async close() {
					if (failure === 'close') throw new Error('Denied at close');
					if (holdClose)
						await new Promise<void>((resolve) => {
							finishClose = resolve;
						});
					source = pending;
				},
				abort
			};
		}
	};
	const directory = {
		async getDirectoryHandle() {
			if (failure === 'nested directory') throw new Error('Denied at nested directory');
			return directory;
		},
		async getFileHandle() {
			if (failure === 'handle') throw new Error('Denied at handle');
			return file;
		}
	};
	vi.stubGlobal('navigator', {
		storage: {
			async getDirectory() {
				if (failure === 'directory') throw new Error('Denied at directory');
				return directory;
			}
		}
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

async function editor() {
	const view = render(Page);
	await waitFor(() => expect(view.getByRole('textbox')).toHaveProperty('value', original));
	await fireEvent.input(view.getByRole('textbox'), { target: { value: changed } });
	return view;
}

for (const [savedPath, destination, refreshes] of [
	['books/main.bean', 'http://localhost/opfs', 1],
	['books/included.bean', 'http://localhost/opfs/edit-file?file=notes.txt', 1],
	['notes.txt', 'http://localhost/opfs/edit-file?file=books/main.bean', 0]
] as const) {
	test(`delayed close refreshes saved ${savedPath}, not the reactive destination ${destination}`, async () => {
		mocks.url.searchParams.set('file', savedPath);
		holdClose = true;
		const view = await editor();
		await fireEvent.click(view.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(finishClose).toBeTypeOf('function'));
		mocks.url.href = destination;
		await tick();
		expect(source).toBe(original);
		expect(mocks.refresh).not.toHaveBeenCalled();
		finishClose!();
		await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
		expect(source).toBe(changed);
		expect(mocks.refresh).toHaveBeenCalledTimes(refreshes);
		expect(mocks.error).not.toHaveBeenCalled();
	});
}

for (const path of ['books/main.bean', 'books/included.bean', 'cashier.bean']) {
	test(`durable ${path} save precedes worker refresh and success waits for refresh`, async () => {
		mocks.url.searchParams.set('file', path);
		holdClose = true;
		let finishRefresh!: () => void;
		mocks.refresh.mockImplementationOnce(async () => {
			expect(source).toBe(changed);
			await new Promise<void>((resolve) => {
				finishRefresh = resolve;
			});
		});
		const view = await editor();
		await fireEvent.click(view.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(finishClose).toBeTypeOf('function'));
		expect(source).toBe(original);
		expect(mocks.refresh).not.toHaveBeenCalled();
		finishClose!();
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
		expect(mocks.success).not.toHaveBeenCalled();
		expect(view.getByRole('button', { name: 'Saving...' })).toHaveProperty('disabled', true);
		finishRefresh();
		await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('File saved successfully'));
		expect(view.queryByText('*Unsaved changes')).toBeNull();
		expect(mocks.error).not.toHaveBeenCalled();
	});
}

for (const stage of ['directory', 'nested directory', 'handle', 'stream', 'write', 'close']) {
	test(`failed ${stage} preserves source and unsaved text, skips refresh and permits retry`, async () => {
		const view = await editor();
		failure = stage;
		await fireEvent.click(view.getByRole('button', { name: 'Save' }));
		await waitFor(() =>
			expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining(`Denied at ${stage}`))
		);
		expect(source).toBe(original);
		expect(view.getByRole('textbox')).toHaveProperty('value', changed);
		expect(view.getByText('*Unsaved changes')).toBeTruthy();
		expect(mocks.refresh).not.toHaveBeenCalled();
		expect(mocks.success).not.toHaveBeenCalled();
		if (stage === 'write' || stage === 'close') expect(abort).toHaveBeenCalledTimes(1);
		failure = null;
		await fireEvent.click(view.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
		expect(source).toBe(changed);
		expect(mocks.refresh).toHaveBeenCalledTimes(1);
	});
}

test('post-save refresh failure reports durable save, not a failed write or successful refresh', async () => {
	mocks.refresh.mockRejectedValueOnce(new Error('Cache close denied'));
	const view = await editor();
	await fireEvent.click(view.getByRole('button', { name: 'Save' }));
	await waitFor(() =>
		expect(mocks.error).toHaveBeenCalledWith(
			expect.stringMatching(/File saved.*analysis.*refresh.*Cache close denied.*Reload/i)
		)
	);
	expect(source).toBe(changed);
	expect(view.queryByText('*Unsaved changes')).toBeNull();
	expect(view.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
	expect(mocks.success).not.toHaveBeenCalled();
});

test('non-book text saves without refreshing full-book analysis', async () => {
	mocks.url.searchParams.set('file', 'notes/review.txt');
	const view = await editor();
	await fireEvent.click(view.getByRole('button', { name: 'Save' }));
	await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
	expect(source).toBe(changed);
	expect(mocks.refresh).not.toHaveBeenCalled();
});

test('typing during a pending save keeps the newer text unsaved', async () => {
	holdClose = true;
	const view = await editor();
	await fireEvent.click(view.getByRole('button', { name: 'Save' }));
	await waitFor(() => expect(finishClose).toBeTypeOf('function'));
	await fireEvent.input(view.getByRole('textbox'), { target: { value: '; newer draft\n' } });
	finishClose!();
	await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
	expect(source).toBe(changed);
	expect(view.getByText('*Unsaved changes')).toBeTruthy();
	expect(view.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
});
