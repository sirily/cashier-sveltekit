import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import init, { Ledger } from '@rustledger/wasm';
import { AssetAllocationEngine } from '#lib/assetAllocation/AssetAllocation';

const definition = `[Allocation]
allocation = 100
[Allocation.Equity]
allocation = 60
symbols = ["FUND"]
[Allocation.Other]
allocation = 40
symbols = ["LONGCOIN", "USD"]
`;
const rootAccount = 'Assets:Investments';
const book = `2000-01-01 open Assets:Investments
2000-01-01 open Assets:Investments:Mixed
2000-01-01 open Assets:INVESTMENTS
2000-01-01 open Assets:INVESTMENTS:Mixed
2000-01-01 open Assets:InvestmentsExtra
2000-01-01 open Assets:Cash
`;

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});

async function allocation(source: string, currency = 'EUR', root = rootAccount, cached = false) {
	const ledger = Ledger.fromFiles({ 'cashier.bean': book + source }, 'cashier.bean');
	const loaded = cached ? Ledger.fromCache(ledger.serialize()) : ledger;
	try {
		const engine = new AssetAllocationEngine();
		await engine.loadFullAssetAllocation(
			definition,
			{ rootAccount: root, currency },
			{
				query: async (bql) => loaded.query(bql),
				getErrors: async () => loaded.getErrors()
			}
		);
		return engine;
	} finally {
		if (cached) loaded.free();
		ledger.free();
	}
}

const mixed = `2025-01-01 price FUND 15 EUR
2025-01-01 price USD 2 EUR
2025-01-02 * "Lot A"
  Assets:Investments:Mixed 2 FUND {10 EUR}
  Assets:Cash -20 EUR
2025-02-02 * "Lot B"
  Assets:Investments:Mixed 3 FUND {12 EUR}
  Assets:Cash -36 EUR
2025-03-02 * "Sell lot A"
  Assets:Investments:Mixed -2 FUND {10 EUR}
  Assets:Cash 20 EUR
2025-03-02 * "Lot C"
  Assets:Investments:Mixed 2 FUND {14 EUR}
  Assets:Cash -28 EUR
2025-03-03 * "Other commodity in the same account"
  Assets:Investments:Mixed 3 LONGCOIN {1 USD}
  Assets:Cash -3 USD
2025-03-04 * "Own investment root"
  Assets:Investments 8 USD
  Assets:Cash -8 USD
2025-03-05 * "Not a descendant"
  Assets:InvestmentsExtra 900 USD
  Assets:Cash -900 USD
2025-03-06 ! "Different root casing, not in scope"
  Assets:INVESTMENTS  800 USD
  Assets:INVESTMENTS:Mixed  200 USD
  Assets:Cash  -1000 USD
2030-01-01 price LONGCOIN 7 USD
2030-01-01 price FUND 25 EUR
`;

test.each([false, true])(
	'values each commodity, signed lots and exact investment scope (cache: %s)',
	async (cached) => {
		const euro = await allocation(mixed, 'EUR', rootAccount, cached);
		expect(euro.valuationComplete).toBe(true);
		expect(euro.warnings).toEqual([]);
		expect([...new Set(euro.holdings.map((holding) => holding.account))].sort()).toEqual([
			rootAccount,
			'Assets:Investments:Mixed'
		]);
		expect(
			euro.assetClasses.map((row) => [row.name, row.currentValue.toString(), row.currency])
		).toEqual([
			['Allocation', '183', 'EUR'],
			['Equity', '125', 'EUR'],
			['Other', '58', 'EUR']
		]);
		const fullDollars = await allocation(mixed, 'USD', rootAccount, cached);
		expect(fullDollars.valuationComplete).toBe(true);
		expect(fullDollars.assetClasses[0].currentValue.toString()).toBe('91.5');
		const dollars = await allocation(mixed, 'USD', 'Assets:Investments:Mixed', cached);
		expect(dollars.valuationComplete).toBe(true);
		expect(dollars.assetClasses.map((row) => row.currentValue.toString())).toEqual([
			'83.5',
			'62.5',
			'21'
		]);
	}
);

test('values holdings in a RustLedger slash-prefixed commodity', async () => {
	const engine = await allocation(
		mixed + '\n2030-01-01 price EUR 2 /ES\n2030-01-01 price USD 4 /ES\n',
		'/ES'
	);
	expect(engine.warnings).toEqual([]);
	expect(engine.valuationComplete).toBe(true);
	expect(engine.assetClasses[0]).toMatchObject({ currency: '/ES' });
	expect(engine.assetClasses[0].currentValue.toString()).toBe('366');
	await expect(allocation(mixed, '/ES"')).rejects.toThrow('invalid valuation currency');
});

test('keeps original units and ledger diagnostics, deduplicates identical warnings, and omits partial totals from export', async () => {
	const engine = await allocation(
		mixed +
			`2025-05-01 * "Unpriced"
  Assets:Investments 7 UNMAPPED
  Assets:Cash -7 UNMAPPED
2025-05-01 * "Unpriced elsewhere"
  Assets:Investments:Mixed 7 UNMAPPED
  Assets:Cash -7 UNMAPPED
2025-05-02 ! "Unresolved"
  Assets:Investments
  Assets:Cash
2025-05-02 ! "Unresolved"
  Assets:Investments
  Assets:Cash
`
	);
	expect(engine.valuationComplete).toBe(false);
	expect(engine.hasAllocationPercentages).toBe(false);
	expect(
		engine.warnings.filter((warning) => warning.includes('No usable price for 7 UNMAPPED in EUR'))
	).toHaveLength(2);
	expect(
		engine.warnings.filter((warning) => warning.includes('7 UNMAPPED is not mapped'))
	).toHaveLength(2);
	expect(
		engine.warnings.filter((warning) => warning.includes('Unresolved posting amount'))
	).toHaveLength(1);
	expect(engine.warnings.join('\n')).toContain('Local book diagnostic:');
	const exported = engine.formatAllocationRowsForTxtExport(engine.assetClasses);
	expect(exported).toContain('Incomplete valuation:');
	expect(exported).toContain('Valuation: EUR');
	expect(exported).toMatch(/Equity\s+60\.00(?:\s+—){6}/);
});

test('distinguishes closed lots and genuinely zero prices from missing valuations', async () => {
	const engine = await allocation(`2025-02-01 price FUND 0 EUR
2025-01-02 * "Buy"
  Assets:Investments 2 SOLD {10 CAD}
  Assets:Cash -20 CAD
2025-01-04 * "Sell"
  Assets:Investments -2 SOLD {10 CAD}
  Assets:Cash 20 CAD
2025-03-01 * "Zero-valued fund"
  Assets:Investments 3 FUND
  Assets:Cash -3 FUND
`);
	expect(engine.valuationComplete).toBe(true);
	expect(engine.assetClasses[0].currentValue.toString()).toBe('0');
	expect(engine.hasAllocationPercentages).toBe(false);
	expect(engine.warnings).toEqual([]);
});

test('diagnoses invalid or unmatched configuration instead of showing zero', async () => {
	await expect(allocation('', 'EUR', 'Assets:.*')).rejects.toThrow(
		'invalid investment account root'
	);
	await expect(allocation('', '', rootAccount)).rejects.toThrow('invalid valuation currency');
	const engine = await allocation('', 'EUR', 'Assets:Unknown');
	expect(engine.valuationComplete).toBe(false);
	expect(engine.warnings[0]).toContain('No account matches Assets:Unknown.');
});
