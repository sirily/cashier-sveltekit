// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import appService from '#lib/services/appService';
import { SettingKeys } from '#lib/settings';
import Home from '../src/routes/+page.svelte';
import HomeSettings from '../src/routes/home-settings/+page.svelte';
import Reorder from '../src/routes/home-reorder/+page.svelte';

const mocks = vi.hoisted(() => ({
	values: new Map<string, unknown>(),
	get: vi.fn(),
	set: vi.fn()
}));
vi.mock('#lib/settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/settings')>()),
	settings: { get: mocks.get, set: mocks.set }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/rustledger', () => ({
	ensureInitialized: vi.fn(),
	createParsedLedger: vi.fn()
}));
vi.mock('#lib/utils/opfslib', () => ({ readFile: async () => '' }));
vi.mock('#lib/services/ledgerService', async () => ({
	default: { version: (await import('svelte/store')).writable(0) }
}));
vi.mock('#lib/services/ledgerWorkerClient', async () => {
	const { writable } = await import('svelte/store');
	return { default: { version: writable(0), isReloading: writable(false) } };
});

beforeEach(() => {
	mocks.values.clear();
	mocks.get.mockReset().mockImplementation(async (key: string) => mocks.values.get(key) ?? null);
	mocks.set.mockReset().mockResolvedValue(undefined);
	vi.spyOn(history, 'back').mockImplementation(() => {});
});
afterEach(cleanup);

const defaults = ['FavouritesCard', 'JournalCard', 'SyncCard'];
const cases: Array<{ name: string; saved: string[] | null; visible: string[] }> = [
	{ name: 'fresh installation', saved: null, visible: defaults },
	{
		name: 'upgrade retaining saved order',
		saved: ['SyncCard', 'ForecastCard', 'JournalCard', 'ScheduledXactCard', 'FavouritesCard'],
		visible: ['SyncCard', 'JournalCard', 'FavouritesCard']
	},
	{ name: 'explicit empty list', saved: [], visible: [] },
	{ name: 'filtered-to-empty list', saved: ['ForecastCard', 'ScheduledXactCard'], visible: [] }
];

for (const { name, saved, visible } of cases) {
	test(`${name}: Home, Home Settings and Reorder share a read-only card list`, async () => {
		if (saved !== null) mocks.values.set(SettingKeys.visibleCards, saved);
		const before = structuredClone(saved);
		expect(await appService.getVisibleCards()).toEqual(visible);

		const home = render(Home);
		await tick();
		await waitFor(() =>
			expect(home.container.querySelectorAll('article.card')).toHaveLength(visible.length)
		);
		const titles = Array.from(home.container.querySelectorAll('.card-body > div > span.grow')).map(
			(element) => element.textContent?.trim()
		);
		const titleByCard: Record<string, string> = {
			FavouritesCard: 'Favourites',
			JournalCard: 'Device Journal',
			SyncCard: 'Server Sync'
		};
		expect(titles).toEqual(visible.map((card) => titleByCard[card]));
		home.unmount();

		const settings = render(HomeSettings);
		await tick();
		await waitFor(() => {
			const checkboxes = settings.getAllByRole('checkbox') as HTMLInputElement[];
			expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual(
				defaults.map((card) => visible.includes(card))
			);
		});
		expect(settings.queryByText('Financial Forecast')).toBeNull();
		expect(settings.queryByText('Scheduled Transactions')).toBeNull();
		settings.unmount();

		const reorder = render(Reorder);
		await tick();
		await waitFor(() =>
			expect(reorder.queryAllByRole('listitem').map((row) => row.textContent?.trim())).toEqual(
				visible
			)
		);
		expect(mocks.set).not.toHaveBeenCalled();
		expect(saved).toEqual(before);
		expect(mocks.values.get(SettingKeys.visibleCards)).toEqual(saved ?? undefined);
	});
}

test('normalization removes only the two literal names, preserving duplicates and unknown values', async () => {
	const saved = [
		'SyncCard',
		'ForecastCard',
		'OtherCard',
		'forecastcard',
		'SyncCard',
		'ScheduledXactCard'
	];
	mocks.values.set(SettingKeys.visibleCards, saved);
	expect(await appService.getVisibleCards()).toEqual([
		'SyncCard',
		'OtherCard',
		'forecastcard',
		'SyncCard'
	]);
	expect(saved).toContain('ForecastCard');
	expect(mocks.set).not.toHaveBeenCalled();
});

for (const { name, saved, visible } of cases) {
	for (const [pageName, Page] of [
		['Home Settings', HomeSettings],
		['Reorder', Reorder]
	] as const) {
		test(`${name}: ${pageName} saves the normalized order only on confirmation`, async () => {
			if (saved !== null) mocks.values.set(SettingKeys.visibleCards, saved);
			const view = render(Page);
			await tick();
			await waitFor(() => {
				if (pageName === 'Home Settings') {
					const checkboxes = view.getAllByRole('checkbox') as HTMLInputElement[];
					expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual(
						defaults.map((card) => visible.includes(card))
					);
				} else {
					expect(view.queryAllByRole('listitem').map((row) => row.textContent?.trim())).toEqual(
						visible
					);
				}
			});
			expect(mocks.set).not.toHaveBeenCalled();
			await fireEvent.click(view.container.querySelector('button.btn-circle')!);
			expect(mocks.set).toHaveBeenCalledExactlyOnceWith(SettingKeys.visibleCards, visible);
		});
	}
}
