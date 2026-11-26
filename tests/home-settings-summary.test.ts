// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';
import { PendingSettingsStore } from '#lib/data/mainStore';
import { SettingKeys } from '#lib/settings';

const mocks = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	set: vi.fn(),
	beforeNavigate: vi.fn(),
	replaceState: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({
	beforeNavigate: mocks.beforeNavigate,
	replaceState: mocks.replaceState
}));
vi.mock('#lib/settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/settings')>()),
	settings: { get: async (key: string) => mocks.values.get(key) ?? null, set: mocks.set }
}));
afterEach(() => {
	cleanup();
	mocks.values.clear();
	PendingSettingsStore.set(undefined);
});

test('Home shows only persisted settings and never initializes or edits preferences', async () => {
	mocks.values.set(SettingKeys.bookFilename, 'selected.bean');
	mocks.values.set(SettingKeys.assetAllocationDefinition, 'alloc.toml');
	mocks.values.set(SettingKeys.currency, 'EUR');
	mocks.values.set(SettingKeys.dateFormat, 'YYYY-MM-DD');
	mocks.values.set(SettingKeys.syncApiToken, 'do-not-read');
	const draft = { currency: 'GBP', bookFilename: 'unsaved.bean' };
	PendingSettingsStore.set(draft);
	const view = render(HomeSectionCards, { cards: ['shortcut:/settings'] });
	for (const value of ['selected.bean', 'alloc.toml', 'EUR', 'YYYY-MM-DD']) {
		expect(await view.findByText(value)).toBeDefined();
	}
	expect(view.queryByText('unsaved.bean')).toBeNull();
	expect(view.queryByText('do-not-read')).toBeNull();
	expect(view.queryByRole('button')).toBeNull();
	expect(view.queryByRole('textbox')).toBeNull();
	expect(mocks.beforeNavigate).not.toHaveBeenCalled();
	expect(mocks.replaceState).not.toHaveBeenCalled();
	expect(mocks.set).not.toHaveBeenCalled();
	expect(get(PendingSettingsStore)).toBe(draft);
});

test('Home presents missing book and allocation selections as not set', async () => {
	const view = render(HomeSectionCards, { cards: ['shortcut:/settings'] });
	const book = await view.findByText('Book file');
	const allocation = view.getByText('Asset allocation definition');
	for (const label of [book, allocation, view.getByText('Main Currency')]) {
		expect(label.nextElementSibling?.textContent?.trim()).toBe('Not set');
	}
	expect(view.getByText('D MMM YYYY')).toBeDefined();
	expect(mocks.set).not.toHaveBeenCalled();
});
