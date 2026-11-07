import { beforeEach, expect, test, vi } from 'vitest';
import type { DAL } from '#lib/data/dal';
import { Account, Payee } from '#lib/data/model';

const state = vi.hoisted(() => ({
	accounts: new Map<string, Account>(),
	payees: new Map<string, Payee>()
}));

vi.mock('#lib/data/db', () => ({
	default: {
		accounts: {
			orderBy: () => ({
				toArray: async () =>
					[...state.accounts.values()].sort((a, b) => a.name.localeCompare(b.name))
			}),
			get: async (name: string) => state.accounts.get(name),
			put: async (account: Account) => {
				state.accounts.set(account.name, account);
				return account.name;
			}
		},
		payees: {
			orderBy: () => ({
				toArray: async () => [...state.payees.values()].sort((a, b) => a.name.localeCompare(b.name))
			})
		}
	}
}));

import CashierDAL from '#lib/data/dbdal';

beforeEach(() => {
	state.accounts.clear();
	state.payees.clear();
	state.accounts.set('Expenses:Food', new Account('Expenses:Food'));
	const cash = new Account('Assets:Cash');
	cash.currencies = ['EUR', 'RUB'];
	state.accounts.set(cash.name, cash);
	state.payees.set('Shop', new Payee('Shop'));
	state.payees.set('Cafe', new Payee('Cafe'));
});

test('loads sorted account and payee references through the retained DAL interface', async () => {
	const dal: DAL = await CashierDAL.create();
	const accounts = await dal.loadAccounts();
	expect(accounts.map((account) => account.name)).toEqual(['Assets:Cash', 'Expenses:Food']);
	expect(accounts[0].currencies).toEqual(['EUR', 'RUB']);
	expect((await dal.loadPayees()).map((payee) => payee.name)).toEqual(['Cafe', 'Shop']);
	expect(state.accounts.size).toBe(2);
	expect(state.payees.size).toBe(2);
});

test('saves and reopens an account while retaining neighboring accounts and payees', async () => {
	const dal = await CashierDAL.create();
	const account = await dal.getAccount('Assets:Cash');
	account.currencies = ['EUR', 'RUB', 'USD'];
	await expect(dal.saveAccount(account)).resolves.toBe('Assets:Cash');

	const reopened = await CashierDAL.create();
	expect((await reopened.getAccount('Assets:Cash')).currencies).toEqual(['EUR', 'RUB', 'USD']);
	expect((await reopened.getAccount('Expenses:Food')).name).toBe('Expenses:Food');
	expect((await reopened.loadPayees()).map((payee) => payee.name)).toEqual(['Cafe', 'Shop']);
});
