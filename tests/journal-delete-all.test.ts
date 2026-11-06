// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { Xact } from '#lib/data/model';
import Page from '../src/routes/journal/+page.svelte';

const mocks = vi.hoisted(() => ({
	save: vi.fn(),
	localRefresh: vi.fn(),
	workerRefresh: vi.fn(),
	read: vi.fn(),
	success: vi.fn(),
	error: vi.fn()
}));
vi.mock('#lib/services/appService', () => ({
	default: { createDefaultCashierFile: mocks.save }
}));
vi.mock('#lib/services/ledgerService', async () => ({
	default: {
		version: (await import('svelte/store')).writable(0),
		getXactsWithSpans: mocks.read,
		invalidate: mocks.localRefresh
	}
}));
vi.mock('#lib/services/ledgerWorkerClient', () => ({
	default: { invalidate: mocks.workerRefresh }
}));
vi.mock('#lib/utils/notifier', () => ({
	default: { init: vi.fn(), success: mocks.success, error: mocks.error }
}));
vi.mock('#lib/data/mainStore', async () => {
	const { writable } = await import('svelte/store');
	return { drawerState: writable(false), xact: writable(null), xactSpan: writable(null) };
});
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const original = '2026-10-02 ! "Pending local draft"\n  Expenses:Food\n  Assets:Cash\n';
let source: string;

beforeEach(() => {
	vi.resetAllMocks();
	source = original;
	const xact = Xact.create();
	xact.payee = 'Pending local draft';
	mocks.read.mockResolvedValue([{ xact, span: { startLine: 0 } }]);
	mocks.save.mockImplementation(async () => {
		source = '';
	});
	mocks.localRefresh.mockResolvedValue(undefined);
	mocks.workerRefresh.mockResolvedValue(undefined);
});
afterEach(cleanup);

async function confirm(view: {
	getByText: (text: string, options: { exact: boolean }) => HTMLElement;
	getByRole: (
		role: string,
		options: { name: string; exact: boolean; hidden: boolean }
	) => HTMLElement;
}) {
	await fireEvent.click(view.getByText('Delete All', { exact: true }));
	await fireEvent.click(view.getByRole('button', { name: 'OK', exact: true, hidden: true }));
}

test('durable clearing precedes both refreshes and success waits for the worker', async () => {
	let save!: () => void;
	let refresh!: () => void;
	mocks.save.mockImplementationOnce(async () => {
		await new Promise<void>((resolve) => {
			save = resolve;
		});
		source = '';
	});
	mocks.workerRefresh.mockImplementationOnce(async () => {
		expect(source).toBe('');
		await new Promise<void>((resolve) => {
			refresh = resolve;
		});
	});
	const view = render(Page);
	await waitFor(() => expect(view.getByText('Pending local draft')).toBeTruthy());
	await confirm(view);
	expect(source).toBe(original);
	expect(mocks.localRefresh).not.toHaveBeenCalled();
	expect(mocks.workerRefresh).not.toHaveBeenCalled();
	save();
	await waitFor(() => expect(mocks.workerRefresh).toHaveBeenCalledTimes(1));
	expect(mocks.localRefresh).toHaveBeenCalledTimes(1);
	expect(view.getByText('The device journal is empty')).toBeTruthy();
	expect(mocks.success).not.toHaveBeenCalled();
	// A second confirmation while the refresh is pending must not clear again.
	await confirm(view);
	expect(mocks.save).toHaveBeenCalledTimes(1);
	refresh();
	await waitFor(() =>
		expect(mocks.success).toHaveBeenCalledWith('All local transactions deleted.')
	);
	expect(mocks.error).not.toHaveBeenCalled();
});

test('failed journal storage preserves the draft, reports the cause and permits retry', async () => {
	mocks.save.mockRejectedValueOnce(new Error('Journal write denied'));
	const view = render(Page);
	await waitFor(() => expect(view.getByText('Pending local draft')).toBeTruthy());
	await confirm(view);
	await waitFor(() =>
		expect(mocks.error).toHaveBeenCalledWith(
			expect.stringMatching(
				/Could not delete local transactions.*Journal write denied.*try.*again/i
			)
		)
	);
	expect(source).toBe(original);
	expect(view.getByText('Pending local draft')).toBeTruthy();
	expect(mocks.localRefresh).not.toHaveBeenCalled();
	expect(mocks.workerRefresh).not.toHaveBeenCalled();
	expect(mocks.success).not.toHaveBeenCalled();
	await confirm(view);
	await waitFor(() => expect(mocks.success).toHaveBeenCalledTimes(1));
	expect(source).toBe('');
	expect(mocks.workerRefresh).toHaveBeenCalledTimes(1);
});

test('worker refresh failure is reported as post-deletion, not a rollback or successful refresh', async () => {
	mocks.workerRefresh.mockRejectedValueOnce(new Error('Cache close denied'));
	const view = render(Page);
	await waitFor(() => expect(view.getByText('Pending local draft')).toBeTruthy());
	await confirm(view);
	await waitFor(() =>
		expect(mocks.error).toHaveBeenCalledWith(
			expect.stringMatching(/Local transactions deleted.*refresh.*Cache close denied.*Reload/i)
		)
	);
	expect(source).toBe('');
	expect(view.getByText('The device journal is empty')).toBeTruthy();
	expect(mocks.localRefresh).toHaveBeenCalledTimes(1);
	expect(mocks.success).not.toHaveBeenCalled();
});

test('local refresh failure cannot prevent worker invalidation or resurrect deleted journal rows', async () => {
	mocks.localRefresh.mockRejectedValueOnce(new Error('Journal read denied'));
	const view = render(Page);
	await waitFor(() => expect(view.getByText('Pending local draft')).toBeTruthy());
	await confirm(view);
	await waitFor(() =>
		expect(mocks.error).toHaveBeenCalledWith(
			expect.stringMatching(/Local transactions deleted.*Journal read denied.*Reload/i)
		)
	);
	expect(source).toBe('');
	expect(mocks.workerRefresh).toHaveBeenCalledTimes(1);
	expect(view.getByText('The device journal is empty')).toBeTruthy();
	expect(mocks.success).not.toHaveBeenCalled();
});

test('cancel does not write or invalidate either ledger', async () => {
	const view = render(Page);
	await fireEvent.click(view.getByText('Delete All', { exact: true }));
	await fireEvent.click(view.getByRole('button', { name: 'Cancel', hidden: true }));
	expect(source).toBe(original);
	expect(mocks.save).not.toHaveBeenCalled();
	expect(mocks.localRefresh).not.toHaveBeenCalled();
	expect(mocks.workerRefresh).not.toHaveBeenCalled();
});
