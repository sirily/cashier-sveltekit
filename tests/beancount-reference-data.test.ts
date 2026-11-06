import { beforeEach, expect, test, vi } from 'vitest';
import type { Account, Payee } from '#lib/data/model';

const state = vi.hoisted(() => ({
	accounts: [] as Account[],
	payees: [] as Payee[]
}));
vi.mock('#lib/data/db', () => ({
	default: {
		accounts: {
			clear: async () => {
				state.accounts = [];
			},
			bulkPut: async (accounts: Account[]) => {
				state.accounts.push(...accounts);
			}
		},
		payees: {
			clear: async () => {
				state.payees = [];
			},
			bulkPut: async (payees: Payee[]) => {
				state.payees.push(...payees);
			}
		},
		transaction: async (_mode: string, _table: unknown, callback: () => Promise<void>) => callback()
	}
}));

vi.mock('#lib/utils/notifier', () => ({ default: { init: vi.fn() } }));

import { syncAccounts, syncPayees } from '#lib/sync/sync-common';
import { getQueries } from '#lib/sync/sync-queries';
import { CashierSyncBeancount } from '#lib/sync/sync-beancount';

beforeEach(() => {
	state.accounts = [{ name: 'Assets:Stale' } as Account];
	state.payees = [{ name: 'Stale payee' } as Payee];
});

test.each([false, true])(
	'replaces Beancount references with original currencies (wrapped rows: %s)',
	async (wrapped) => {
		const rows = [
			['10801', 'RUB', 'Assets:Cash'],
			['12', 'USD', 'Assets:Cash'],
			['-3.5', 'GBP', 'Assets:Cash'],
			['0.25', 'XAU', 'Assets:Cash'],
			['7', 'LONGCOIN', 'Assets:Investments']
		];
		const response = wrapped ? { columns: ['amount', 'currency', 'account'], rows } : rows;
		await syncAccounts(response as unknown as Record<string, unknown>);
		expect(state.accounts.map((account) => account.name)).toEqual([
			'Assets:Cash',
			'Assets:Investments'
		]);
		expect(state.accounts[0].balances).toEqual({ RUB: 10801, USD: 12, GBP: -3.5, XAU: 0.25 });
		expect(state.accounts[0].currencies).toEqual(['GBP', 'RUB', 'USD', 'XAU']);
		expect(state.accounts[1].balances).toEqual({ LONGCOIN: 7 });
		expect(state.accounts[1].currencies).toEqual(['LONGCOIN']);
		expect(rows[0]).toEqual(['10801', 'RUB', 'Assets:Cash']);

		await syncPayees([' Cafe ', 'Shop', 'Cafe', '']);
		expect(state.payees.map((payee) => payee.name)).toEqual(['Cafe', 'Shop']);
	}
);

test('empty or unsupported reference responses preserve existing references', async () => {
	const before = structuredClone(state);
	await expect(syncAccounts({ rows: [] })).rejects.toThrow('No balance records');
	await expect(syncAccounts({ unexpected: true })).rejects.toThrow('Unsupported Beancount');
	await expect(syncPayees([])).rejects.toThrow('No payees');
	expect(state).toEqual(before);
});

test('server payee rows use Beancount queries and keep complete names', async () => {
	const network = vi
		.fn()
		.mockResolvedValue(new Response(JSON.stringify([['Cafe'], ['Long shop name']])));
	vi.stubGlobal('fetch', network);
	try {
		const server = new CashierSyncBeancount('https://server.test/api', 'device-token');
		await expect(server.readPayees()).resolves.toEqual(['Cafe', 'Long shop name']);
		const [url, options] = network.mock.calls[0];
		expect((url as URL).searchParams.get('query')).toContain(
			'SELECT DISTINCT COALESCE(payee, narration)'
		);
		expect((options as RequestInit).headers).toBeInstanceOf(Headers);
		expect(new Headers(options.headers).get('Authorization')).toBe('Bearer device-token');
		expect(getQueries().accounts()).toBe('SELECT sum(number), currency, account ORDER BY account');
	} finally {
		vi.unstubAllGlobals();
	}
});
