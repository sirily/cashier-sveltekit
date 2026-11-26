// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';
import { selectionMetadata, xact } from '#lib/data/mainStore';
import { Xact } from '#lib/data/model';

vi.mock('$app/paths', () => ({
	resolve: (path: string, params?: { accountName: string }) =>
		params ? path.replace('[accountName]', params.accountName) : path
}));
vi.mock('#lib/services/ledgerWorkerClient', async () => {
	const { writable } = await import('svelte/store');
	return { default: { version: writable(0), isReloading: writable(false) } };
});
vi.mock('#lib/services/referenceLists', () => ({
	readAccountReferences: async () => [
		{ name: 'Assets:Cash', currencies: ['USD', 'EUR'] },
		{ name: 'Expenses:Food', currencies: ['USD'] }
	],
	readPayeeReferences: async () => ['Bakery', 'Café']
}));

afterEach(() => {
	cleanup();
	selectionMetadata.set(undefined);
});

test('Home has independent reference filters and never uses editor selection or autofocus', async () => {
	const editor = Xact.create();
	editor.payee = 'Existing payee';
	xact.set(editor);
	const selection = {
		origin: '',
		selectedId: undefined,
		selectionType: 'account',
		postingIndex: 0
	};
	selectionMetadata.set(selection);
	const back = vi.spyOn(history, 'back').mockImplementation(() => {});
	const view = render(HomeSectionCards, { cards: ['shortcut:/accounts', 'shortcut:/payees'] });
	const accountSearch = await view.findByRole('searchbox', { name: 'Search accounts' });
	const payeeSearch = await view.findByRole('searchbox', { name: 'Search payees' });
	const account = await view.findByRole('link', { name: /Assets:Cash/ });
	expect(account.getAttribute('href')).toBe('/accounts/account-xacts/Assets%3ACash');
	expect(document.activeElement).not.toBe(accountSearch);
	expect(document.activeElement).not.toBe(payeeSearch);
	await fireEvent.input(accountSearch, { target: { value: 'cash' } });
	await waitFor(() => expect(view.queryByText('Expenses:Food')).toBeNull());
	expect(view.getByText('Café')).toBeDefined();
	await fireEvent.input(payeeSearch, { target: { value: 'bak' } });
	await waitFor(() => expect(view.queryByText('Café')).toBeNull());
	expect(view.getByText('Bakery')).toBeDefined();
	expect(view.getByText('Assets:Cash')).toBeDefined();
	await fireEvent.click(view.getByText('Bakery'));
	expect(get(selectionMetadata)).toBe(selection);
	expect(get(xact)).toBe(editor);
	expect(selection.selectedId).toBeUndefined();
	expect(back).not.toHaveBeenCalled();
});
