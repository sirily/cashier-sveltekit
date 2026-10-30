import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { queryReportPostings, type ReportCriteria } from '#lib/services/reportPostings';
import init, { Ledger, version } from '@rustledger/wasm';

const accounts = `2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2000-01-01 open Income:Salary
`;
const incomplete = `2026-06-10 ! "Unfinished"
  Expenses:Food
  Assets:Cash
`;
const ledgers: Ledger[] = [];

function book(overlay: string, selected = '', cached = false) {
	const ledger = Ledger.fromFiles(
		{
			'cashier.bean': `include "selected.bean"\n${overlay}`,
			'selected.bean': `${accounts}\ninclude "included.bean"\n${selected}`,
			'included.bean': `2026-06-01 ! "Desktop interpolated"
  Expenses:Food
  Assets:Cash -10 USD
`
		},
		'cashier.bean'
	);
	ledgers.push(ledger);
	if (!cached) return ledger;
	const restored = Ledger.fromCache(ledger.serialize());
	ledgers.push(restored);
	return restored;
}

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
	expect(version()).toBe('0.14.1');
});

afterEach(() => {
	for (const ledger of ledgers.splice(0)) ledger.free();
});

describe.each([false, true])('real WASM (cache roundtrip: %s)', (cached) => {
	test('reproduces the original null-position conversion failure in both report queries', () => {
		const ledger = book(incomplete, '', cached);
		const raw = ledger.query('SELECT date, account, position WHERE position IS NULL');
		expect(raw.errors).toEqual([]);
		expect(raw.rows).toEqual([
			['2026-06-10', 'Expenses:Food', null],
			['2026-06-10', 'Assets:Cash', null]
		]);
		for (const scope of [
			'account ~ "^Expenses"',
			'(account ~ "^Income" OR account ~ "^Expenses")'
		]) {
			const result = ledger.query(
				`SELECT account, NUMBER(CONVERT(units(position), "USD")) AS number WHERE ${scope} AND date >= 2026-06-01 AND date <= 2026-06-30`
			);
			expect(result.errors.map((e) => e.message)).toEqual([
				'Query execution error: type error: UNITS expects a position or inventory'
			]);
		}
		expect(ledger.getErrors().map((e) => e.message)).toContain(
			'Transaction has 2 postings with missing amounts; at most one is allowed'
		);
	});

	const criteria: ReportCriteria = {
		scope: 'expenses',
		dateFrom: '2026-06-01',
		dateTo: '2026-06-30',
		currency: 'USD'
	};
	function client(ledger: Ledger) {
		return {
			query: vi.fn(async (bql: string) => ledger.query(bql)),
			getErrors: async () => ledger.getErrors()
		};
	}

	test.each(['expenses', 'income-expense'] as const)(
		'prevalidates %s without invoking conversion on null',
		async (scope) => {
			const api = client(book(incomplete, '', cached));
			const result = await queryReportPostings(api, { ...criteria, scope });
			expect(api.query).toHaveBeenCalledTimes(1);
			expect(api.query.mock.calls[0][0]).not.toContain('CONVERT');
			expect(result.complete).toBe(false);
			expect(result.postings).toEqual([]);
			expect(result.issues).toEqual([
				expect.objectContaining({
					date: '2026-06-10',
					account: 'Expenses:Food',
					description: 'Unfinished',
					message: expect.stringContaining('Unresolved posting amount')
				})
			]);
			expect(result.diagnostics.join('; ')).toContain('2 postings with missing amounts');
		}
	);

	test.each(['expenses', 'income-expense'] as const)(
		'preserves %s overlay, selected includes, boundaries, !, interpolation and signed conversion',
		async (scope) => {
			const overlay = `2026-06-30 ! "Refund at end boundary"
  Expenses:Food -2 USD
  Assets:Cash 2 USD
2026-07-01 * "After period"
  Expenses:Food 900 USD
  Assets:Cash -900 USD
2026-05-31 * "Before period"
  Expenses:Food 800 USD
  Assets:Cash -800 USD
2026-06-15 ! "Interpolated income"
  Income:Salary
  Assets:Cash 100 USD
2026-06-16 * "Income reversal"
  Income:Salary 5 USD
  Assets:Cash -5 USD
`;
			const selected = `2026-05-01 price LONGCOIN 2 USD
2026-06-01 price LONGCOIN 3 USD
2026-07-01 price LONGCOIN 4 USD
2026-06-10 ! "Long priced commodity"
  Expenses:Food 5 LONGCOIN
  Assets:Cash -5 LONGCOIN
`;
			const result = await queryReportPostings(client(book(overlay, selected, cached)), {
				...criteria,
				scope
			});
			expect(result).toMatchObject({ complete: true, issues: [], diagnostics: [] });
			const expenses = result.postings.filter((p) => p.account.startsWith('Expenses'));
			expect(expenses).toEqual([
				{ date: '2026-06-01', account: 'Expenses:Food', amount: 10 },
				{ date: '2026-06-10', account: 'Expenses:Food', amount: 20 },
				{ date: '2026-06-30', account: 'Expenses:Food', amount: -2 }
			]);
			expect(expenses.reduce((sum, p) => sum + p.amount, 0)).toBe(28);
			const income = result.postings.filter((p) => p.account.startsWith('Income'));
			expect(income.map((p) => p.amount)).toEqual(scope === 'expenses' ? [] : [-100, 5]);
		}
	);

	test('converts signed foreign income, reversal and refund with the same latest-price policy', async () => {
		const ledger = book(
			`2026-06-30 ! "Foreign income"
  Income:Salary -100 GBP
  Assets:Cash 100 GBP
2026-06-30 ! "Foreign reversal"
  Income:Salary 5 GBP
  Assets:Cash -5 GBP
2026-06-30 ! "Foreign refund"
  Expenses:Food -2 GBP
  Assets:Cash 2 GBP
`,
			'2026-06-01 price GBP 2 USD\n',
			cached
		);
		const result = await queryReportPostings(client(ledger), {
			...criteria,
			scope: 'income-expense'
		});
		expect(result.complete).toBe(true);
		expect(
			result.postings.filter((p) => p.account.startsWith('Income')).map((p) => p.amount)
		).toEqual([-200, 10]);
		expect(
			result.postings.filter((p) => p.account.startsWith('Expenses')).map((p) => p.amount)
		).toEqual([10, -4]);
	});

	test.each(['UNKNOWN', 'XAU', 'RUB', 'GBP'])(
		'retains unvalued %s in diagnostics and never substitutes USD or a partial total',
		async (commodity) => {
			const ledger = book(
				`2026-06-12 ! "Unvalued"
  Expenses:Food 7 ${commodity}
  Assets:Cash -7 ${commodity}
`,
				'',
				cached
			);
			const result = await queryReportPostings(client(ledger), criteria);
			expect(result.complete).toBe(false);
			expect(result.postings).toEqual([]);
			expect(result.issues[0].message).toContain(`original amount: 7 ${commodity}`);
		}
	);

	test('does not let out-of-period or out-of-scope nulls reach conversion; keeps ledger diagnostics', async () => {
		const ledger = book(
			incomplete.replace('2026-06-10', '2026-07-01') +
				`
2026-06-12 ! "Unresolved transfer"
  Assets:Cash
  Assets:Cash
`,
			'',
			cached
		);
		const api = client(ledger);
		const result = await queryReportPostings(api, criteria);
		expect(api.query).toHaveBeenCalledTimes(2);
		expect(result.issues).toEqual([]);
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(result.complete).toBe(false);
		expect(result.postings).toEqual([]);
	});

	test('distinguishes a successfully empty period from incompleteness', async () => {
		const result = await queryReportPostings(client(book('', '', cached)), {
			...criteria,
			dateFrom: '2026-08-01',
			dateTo: '2026-08-31'
		});
		expect(result).toEqual({ complete: true, postings: [], issues: [], diagnostics: [] });
	});
});
