// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { Account } from '#lib/data/model';
import Page from '../src/routes/accounts/account-xacts/[accountName]/+page.svelte';
import type { PageData } from '../src/routes/accounts/account-xacts/[accountName]/$types';

const mocks = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('$app/navigation', () => ({ invalidate: mocks.invalidate, goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/ledgerWorkerClient', async () => {
	const { writable } = await import('svelte/store');
	return {
		default: { version: writable(1), loaded: writable(true), isReloading: writable(false) }
	};
});
vi.mock('#lib/data/mainStore', async () => {
	const { writable } = await import('svelte/store');
	return { drawerState: writable(false), xact: writable(null), xactSpan: writable(null) };
});

beforeEach(() => {
	mocks.invalidate.mockReset().mockResolvedValue(undefined);
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			observe() {}
			disconnect() {}
		}
	);
});
afterEach(cleanup);

function success(): Awaited<PageData['history']> {
	return {
		data: {
			account: new Account('Assets:Cash'),
			unifiedRows: [],
			hasDeviceXacts: false,
			version: 1
		},
		error: null
	};
}

test('pending, operational error and genuinely empty balance are distinct', async () => {
	let finish!: (value: Awaited<PageData['history']>) => void;
	const history = new Promise<Awaited<PageData['history']>>((resolve) => {
		finish = resolve;
	});
	const view = render(Page, { data: { accountName: 'Assets:Cash', history } });
	expect(view.getByRole('status').textContent).toContain('Loading account history');
	expect(view.container.querySelector('header')).toBeNull();
	finish({ data: null, error: 'OPFS read denied' });
	await waitFor(() => expect(view.getByRole('alert').textContent).toContain('OPFS read denied'));
	expect(view.container.querySelector('header')).toBeNull();
	await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
	expect(mocks.invalidate).toHaveBeenCalledWith('ledger:account-history');

	await view.rerender({
		data: { accountName: 'Assets:Cash', history: Promise.resolve(success()) }
	});
	await waitFor(() => expect(view.container.querySelector('header')?.textContent).toContain('0'));
	expect(view.queryByRole('alert')).toBeNull();
	expect(view.queryByRole('status')).toBeNull();
});

test('a late result for a previous account cannot replace the new history', async () => {
	let finish!: (value: Awaited<PageData['history']>) => void;
	const history = new Promise<Awaited<PageData['history']>>((resolve) => {
		finish = resolve;
	});
	const view = render(Page, { data: { accountName: 'Assets:Cash', history } });
	const bank = success();
	if (bank.data) {
		bank.data.account = new Account('Assets:Bank');
		bank.data.account.balances = { RUB: 10801, USD: 12 };
	}
	await view.rerender({ data: { accountName: 'Assets:Bank', history: Promise.resolve(bank) } });
	await waitFor(() =>
		expect(view.container.querySelector('header')?.textContent).toContain('Bank')
	);
	finish(success());
	await Promise.resolve();
	expect(view.container.querySelector('header')?.textContent).toContain('Bank');
	expect(view.container.querySelector('header')?.textContent).toContain('RUB');
	expect(view.container.querySelector('header')?.textContent).toContain('USD');
});
