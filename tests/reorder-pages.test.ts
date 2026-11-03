// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { xact } from '#lib/data/mainStore';
import { Xact } from '#lib/data/model';
import { SettingKeys } from '#lib/settings';
import Favourites from '../src/routes/favourites/reorder/+page.svelte';
import Home from '../src/routes/home-reorder/+page.svelte';
import Postings from '../src/routes/postings/reorder/+page.svelte';
import AccountGroups from '../src/routes/accounts/groups/reorder/+page.svelte';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), getVisibleCards: vi.fn() }));
vi.mock('#lib/settings', async (importOriginal) => {
	const original = await importOriginal<typeof import('#lib/settings')>();
	return { SettingKeys: original.SettingKeys, settings: { get: mocks.get, set: mocks.set } };
});
vi.mock('#lib/services/appService', () => ({
	default: { getVisibleCards: mocks.getVisibleCards }
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

beforeEach(() => {
	mocks.get.mockReset();
	mocks.set.mockReset().mockResolvedValue(undefined);
	mocks.getVisibleCards.mockReset();
	vi.spyOn(history, 'back').mockImplementation(() => {});
	// jsdom has no layout or pointer capture; exercise the real component's pointer handlers.
	vi.stubGlobal('PointerEvent', MouseEvent);
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		width: 300,
		height: 52,
		bottom: 52,
		right: 300,
		toJSON: () => ({})
	});
	Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
		configurable: true,
		value: vi.fn()
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
});

async function moveFirstToLast(view: { container: HTMLElement }) {
	const queries = within(view.container);
	await waitFor(() => expect(queries.getAllByRole('listitem')).toHaveLength(3));
	const list = queries.getByRole('list');
	const first = queries.getAllByRole('listitem')[0];
	await fireEvent.pointerDown(first.querySelector('button')!, { clientY: 26 });
	await fireEvent.pointerMove(list, { clientY: 130 });
	await fireEvent.pointerUp(list);
}

function confirm(view: { container: HTMLElement }) {
	return fireEvent.click(view.container.querySelector('button.btn-circle')!);
}

test('favourites keeps duplicate values and saves the parent-bound order on confirmation', async () => {
	mocks.get.mockResolvedValue(['Assets:Cash', 'Assets:Cash', 'Assets:Bank']);
	const view = render(Favourites);
	await moveFirstToLast(view);
	expect(view.getAllByRole('listitem').map((row) => row.textContent?.trim())).toEqual([
		'Assets:Cash',
		'Assets:Bank',
		'Assets:Cash'
	]);
	expect(mocks.set).not.toHaveBeenCalled();
	await confirm(view);
	expect(mocks.set).toHaveBeenCalledWith(SettingKeys.favouriteAccounts, [
		'Assets:Cash',
		'Assets:Bank',
		'Assets:Cash'
	]);
});

test('home saves the parent-bound card order without dropping duplicate labels', async () => {
	mocks.getVisibleCards.mockResolvedValue(['Journal', 'Journal', 'Sync']);
	const view = render(Home);
	await moveFirstToLast(view);
	expect(mocks.set).not.toHaveBeenCalled();
	await confirm(view);
	expect(mocks.set).toHaveBeenCalledWith(SettingKeys.visibleCards, ['Journal', 'Sync', 'Journal']);
});

test('postings updates the editor only on confirmation and preserves same-account identities', async () => {
	const postings = [
		{ account: 'Expenses:Food', amount: 10, currency: 'USD' },
		{ account: 'Expenses:Food', amount: 20, currency: 'USD' },
		{ account: 'Assets:Cash', amount: -30, currency: 'USD' }
	];
	const transaction = Object.assign(new Xact(), { note: 'Keep narration', postings });
	xact.set(transaction);
	const view = render(Postings);
	await moveFirstToLast(view);
	expect(get(xact)).toBe(transaction);
	expect(get(xact).postings).toEqual(postings);
	await confirm(view);
	expect(get(xact).postings).toEqual([postings[1], postings[2], postings[0]]);
	expect(get(xact).note).toBe('Keep narration');
});

test('account groups persist distinct same-title groups on drop through their custom row', async () => {
	const groups = [
		{ title: 'Same', accounts: ['Assets:Cash'] },
		{ title: 'Same', accounts: ['Assets:Bank'] },
		{ title: 'Last', accounts: ['Assets:Other'] }
	];
	mocks.get.mockResolvedValue(groups);
	const view = render(AccountGroups);
	await moveFirstToLast(view);
	expect(mocks.set).toHaveBeenCalledExactlyOnceWith(SettingKeys.accountGroups, [
		groups[1],
		groups[2],
		groups[0]
	]);
});
