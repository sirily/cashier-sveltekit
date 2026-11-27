import { readFileSync } from 'node:fs';
import init, { Ledger } from '@rustledger/wasm';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { readCalculatorAccounts, readCalculatorBalances } from '#lib/services/calculatorBalances';

const worker = vi.hoisted(() => ({ query: vi.fn(), getErrors: vi.fn() }));
vi.mock('#lib/services/ledgerWorkerClient', () => ({ default: worker }));

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});

let ledger: Ledger | undefined;
afterEach(() => {
	ledger?.free();
	ledger = undefined;
	vi.resetAllMocks();
});

function loadBook(extra = '') {
	const book = Ledger.fromFiles(
		{
			'cashier.bean': `include "book.bean"
2024-02-01 ! "On device"
  Assets:Cash 0.20 USD
  Equity:Opening -0.20 USD
${extra}`,
			'book.bean': `2024-01-01 open Assets:Cash
2024-01-01 open Assets:Cash:Child
2024-01-01 open Assets:Empty
2024-01-01 open Assets:Retired
2024-01-01 open Equity:Opening
2024-01-02 * "Downloaded"
  Assets:Cash 0.10 USD
  Assets:Cash -42.50 EUR
  Assets:Cash:Child 100 USD
  Equity:Opening -100.10 USD
  Equity:Opening 42.50 EUR
2024-04-01 close Assets:Retired
`
		},
		'cashier.bean'
	);
	ledger = book;
	worker.query.mockImplementation(async (query: string) => book.query(query));
	worker.getErrors.mockImplementation(async () => book.getErrors());
}

test('reads exact signed units per currency from the selected book and overlay', async () => {
	loadBook();
	expect(await readCalculatorAccounts()).toContain('Assets:Retired');
	expect(await readCalculatorBalances('Assets:Cash')).toEqual([
		{ amount: '-42.5', currency: 'EUR' },
		{ amount: '0.3', currency: 'USD' }
	]);
	expect(await readCalculatorBalances('Assets:Empty')).toEqual([]);
});

test('reports a missing include instead of presenting the account list as empty', async () => {
	const book = Ledger.fromFiles({ 'cashier.bean': 'include "missing.bean"\n' }, 'cashier.bean');
	ledger = book;
	worker.query.mockImplementation(async (query: string) => book.query(query));
	worker.getErrors.mockImplementation(async () => book.getErrors());
	await expect(readCalculatorAccounts()).rejects.toThrow(
		/Local book diagnostics:.*missing\.bean/is
	);
});

test('distinguishes a successfully queried empty book from an incomplete book', async () => {
	worker.query.mockResolvedValue({ columns: ['account'], rows: [], errors: [] });
	worker.getErrors.mockResolvedValue([]);
	await expect(readCalculatorAccounts()).resolves.toEqual([]);
});

test('does not filter out dated entries after today from the book balance', async () => {
	loadBook(`2099-01-01 * "Future entry"
  Assets:Cash -0.10 USD
  Equity:Opening 0.10 USD
`);
	expect(await readCalculatorBalances('Assets:Cash')).toContainEqual({
		amount: '0.2',
		currency: 'USD'
	});
});

test('does not offer a partial total for an account with unresolved postings', async () => {
	loadBook(`2024-03-01 ! "Unfinished"
  Assets:Cash
  Equity:Opening
`);
	await expect(readCalculatorBalances('Assets:Cash')).rejects.toThrow('unresolved posting');
});

test('propagates analysis and query failures rather than reporting a zero balance', async () => {
	worker.query.mockRejectedValue(new Error('No local book loaded.'));
	await expect(readCalculatorBalances('Assets:Cash')).rejects.toThrow('No local book');
	worker.query.mockResolvedValue({ columns: [], rows: [], errors: ['query failed'] });
	await expect(readCalculatorBalances('Assets:Cash')).rejects.toThrow('query failed');
});
