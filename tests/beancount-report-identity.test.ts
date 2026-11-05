import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import init, { Ledger } from '@rustledger/wasm';

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});

test.each([false, true])(
	'Beancount posting queries preserve distinct identical headers and original currencies (cache: %s)',
	(cached) => {
		const source = `2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2026-11-01 * "Shop" "Identical header"
  cashier_id: "first-id"
  Expenses:Food 10 GBP
  Assets:Cash -10 GBP
2026-11-01 * "Shop" "Identical header"
  cashier_id: "second-id"
  Expenses:Food 10 GBP
  Assets:Cash -10 GBP
2026-11-01 * "Shop" "Identical header"
  Expenses:Food 2 XAU
  Assets:Cash -2 XAU
`;
		const parsed = Ledger.fromFiles({ 'cashier.bean': source }, 'cashier.bean');
		const ledger = cached ? Ledger.fromCache(parsed.serialize()) : parsed;
		try {
			expect(ledger.getErrors()).toEqual([]);
			const result = ledger.query(
				'SELECT id, date, payee, narration, account, number, currency WHERE account = "Expenses:Food" ORDER BY id'
			);
			expect(result.errors).toEqual([]);
			expect(result.rows).toHaveLength(3);
			expect(new Set(result.rows.map((row) => row[0])).size).toBe(3);
			expect(result.rows.map((row) => row.slice(1))).toEqual([
				['2026-11-01', 'Shop', 'Identical header', 'Expenses:Food', '10', 'GBP'],
				['2026-11-01', 'Shop', 'Identical header', 'Expenses:Food', '10', 'GBP'],
				['2026-11-01', 'Shop', 'Identical header', 'Expenses:Food', '2', 'XAU']
			]);
		} finally {
			if (cached) ledger.free();
			parsed.free();
		}
	}
);
