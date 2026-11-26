// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';

const mocks = vi.hoisted(() => ({
	getDirectives: vi.fn(),
	getErrors: vi.fn(),
	invalidate: vi.fn(),
	load: vi.fn(),
	reset: vi.fn(),
	deleteCache: vi.fn(),
	loadFromCache: vi.fn(),
	serialize: vi.fn(),
	save: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/ledgerWorkerClient', async () => {
	const { writable } = await import('svelte/store');
	return {
		default: {
			...mocks,
			loaded: writable(true),
			isReloading: writable(false),
			version: writable(1)
		}
	};
});
vi.mock('#lib/settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/settings')>()),
	settings: { get: async () => '123456789abcdef', set: mocks.save }
}));
vi.mock('#lib/utils/opfslib', () => ({ getFileMetadata: async () => ({ size: 40 }) }));
afterEach(cleanup);

test('Serialization and Validation expose local evidence without running tool actions', async () => {
	mocks.getDirectives.mockResolvedValueOnce([{}, {}]);
	mocks.getErrors.mockResolvedValueOnce([
		{ severity: 'error', line: 1, column: 2, message: 'Ledger parse example' },
		{ severity: 'warning', line: 2, column: 1, message: 'Ledger warning example' }
	]);
	const view = render(HomeSectionCards, {
		cards: ['shortcut:/tools/serialization', 'shortcut:/util/validation']
	});
	await view.findByText('Ledger loaded (2 directives)');
	expect(view.getByText('40 bytes')).toBeDefined();
	expect(view.getByText('123456789abc…')).toBeDefined();
	await view.findByText('Ledger parse example');
	expect(view.getByText('1 error, 1 warning')).toBeDefined();
	expect(view.getByText('Ledger warning example')).toBeDefined();
	expect(view.getByRole('link', { name: 'Inspect parsed ledger' }).getAttribute('href')).toBe(
		'/ledger/multi'
	);
	expect(
		view.queryByRole('button', { name: /Reload|Delete cache|Reset|Serialize|Load/ })
	).toBeNull();
	for (const command of [
		mocks.invalidate,
		mocks.load,
		mocks.reset,
		mocks.deleteCache,
		mocks.loadFromCache,
		mocks.serialize,
		mocks.save
	]) {
		expect(command).not.toHaveBeenCalled();
	}
});

test('unavailable validation never claims that the book is valid', async () => {
	mocks.getErrors.mockRejectedValueOnce(new Error('Selected book missing'));
	const view = render(HomeSectionCards, { cards: ['shortcut:/util/validation'] });
	await waitFor(() =>
		expect(view.getByRole('alert').textContent).toContain('Selected book missing')
	);
	expect(view.queryByText('All clear!')).toBeNull();
});
