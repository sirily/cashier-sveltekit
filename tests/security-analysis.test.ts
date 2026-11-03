import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import init, { Ledger } from '@rustledger/wasm';

vi.mock('#lib/settings', () => ({
	SettingKeys: { currency: 'currency' },
	settings: { get: vi.fn(async () => 'GBP') }
}));
vi.mock('#lib/services/appService', () => ({
	default: { getDefaultCurrency: vi.fn(async () => 'GBP') }
}));
import { SecurityAnalyser, type QueryFn } from '#lib/assetAllocation/securityAnalysis';
import { getQueries } from '#lib/sync/sync-queries';

const source = `2000-01-01 open Assets:Broker
2000-01-01 open Assets:Cash
2000-01-01 open Income:Dividend:LONGCOIN
2026-01-01 commodity LONGCOIN
2026-06-02 price LONGCOIN 12 GBP
2026-01-02 * "Purchase"
  Assets:Broker 10 LONGCOIN {10 GBP}
  Assets:Cash -100 GBP
2026-06-01 * "Dividend"
  Income:Dividend:LONGCOIN -6 GBP
  Assets:Cash 6 GBP
`;
let ledger: Ledger;
let network: ReturnType<typeof vi.fn>;

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
	network = vi.fn(() => {
		throw new Error('Reports must stay local');
	});
	vi.stubGlobal('fetch', network);
	ledger = Ledger.fromFiles(
		{ 'cashier.bean': 'include "book.bean"', 'book.bean': source },
		'cashier.bean'
	);
	expect(ledger.getErrors()).toEqual([]);
});
afterEach(() => {
	ledger.free();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test.each([false, true])(
	'investment yield and gain/loss run through injected local WASM (cache: %s)',
	async (cached) => {
		const local = cached ? Ledger.fromCache(ledger.serialize()) : ledger;
		try {
			const query = vi.fn(async (bql: string) => local.query(bql));
			const analyser = new SecurityAnalyser(query);
			await expect(analyser.getYield('LONGCOIN')).resolves.toBe('5.00%');
			await expect(analyser.getGainLoss('LONGCOIN')).resolves.toBe('20.00 GBP, 20.00%');
			expect(query.mock.calls.map(([bql]) => bql)).toEqual([
				getQueries().incomeBalance('LONGCOIN', '2025-11-03', 'GBP'),
				getQueries().valueBalance('LONGCOIN', 'GBP'),
				getQueries().gainLoss('LONGCOIN', 'GBP')
			]);
			expect(local.query('SELECT currency, sum(number) GROUP BY currency').rows).toEqual(
				expect.arrayContaining([
					['LONGCOIN', '10'],
					['GBP', '-100']
				])
			);
			expect(network).not.toHaveBeenCalled();
		} finally {
			if (cached) local.free();
		}
	}
);

test('BQL errors and unavailable local backend propagate without HTTP retry', async () => {
	const query: QueryFn = async () => ({
		columns: [],
		rows: [],
		errors: [{ message: 'Local query failed' }]
	});
	await expect(new SecurityAnalyser(query).getGainLoss('LONGCOIN')).rejects.toThrow(
		'BQL query failed: Local query failed'
	);
	const unavailable: QueryFn = async () => {
		throw new Error('Worker unavailable');
	};
	await expect(new SecurityAnalyser(unavailable).getGainLoss('LONGCOIN')).rejects.toThrow(
		'Worker unavailable'
	);
	expect(network).not.toHaveBeenCalled();
});

test('gain/loss retains empty-result and multiple-record handling', async () => {
	const query = vi
		.fn<QueryFn>()
		.mockResolvedValueOnce({ columns: [], rows: [], errors: [] })
		.mockResolvedValueOnce({
			columns: [],
			rows: [
				['(10 GBP)', '(12 GBP)'],
				['(20 GBP)', '(24 GBP)']
			],
			errors: []
		});
	const analyser = new SecurityAnalyser(query);
	await expect(analyser.getGainLoss('LONGCOIN')).resolves.toBe('n/a');
	await expect(analyser.getGainLoss('LONGCOIN')).rejects.toThrow('Multiple gain/loss records');
	expect(network).not.toHaveBeenCalled();
});
