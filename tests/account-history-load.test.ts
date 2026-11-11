import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { Ledger } from '@rustledger/wasm';
import { Account, Xact, Posting } from '#lib/data/model';
import Big from 'big.js';
import { load } from '../src/routes/accounts/account-xacts/[accountName]/+page';

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	getXactsWithSpans: vi.fn(),
	account: vi.fn(),
	source: ''
}));
vi.mock('#lib/utils/opfslib', () => ({ readFile: async () => mocks.source }));
vi.mock('#lib/services/rustledger', async () => {
	const wasm = await import('@rustledger/wasm');
	return {
		ensureInitialized: async () => {},
		createParsedLedger: (source: string) => new wasm.ParsedLedger(source),
		format: wasm.format,
		getAccountsFromTransactions: () => [],
		version: wasm.version
	};
});
vi.mock('#lib/data/initializer', () => ({ ensureInitialized: vi.fn() }));
vi.mock('#lib/services/ledgerService.js', () => ({
	default: { load: vi.fn(), getXactsWithSpans: mocks.getXactsWithSpans }
}));
vi.mock('#lib/services/ledgerWorkerClient', async () => {
	const { writable } = await import('svelte/store');
	return {
		default: {
			ensureLoaded: vi.fn(),
			isLoaded: true,
			version: writable(1),
			query: mocks.query,
			getAccountWithBalances: mocks.account
		}
	};
});

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});
beforeEach(() => vi.clearAllMocks());

const accountName = 'Assets:Physical:Cash';
const narration = 'QA-RC93-draft-offline-edited';

async function history(payee: string, amounts: (number | string)[], copies = 1, desktop = '') {
	const header = `2026-11-06 ! ${payee ? `"${payee}" ` : ''}"${narration}"`;
	const source = `${header}\n${amounts.map((amount) => `  ${accountName} ${amount} USD`).join('\n')}\n  Expenses:Groceries ${amounts
		.reduce<Big>((sum, amount) => sum.plus(String(amount).replace(/^\+/, '')), new Big(0))
		.neg()
		.toFixed()} USD\n`;
	const ledger = Ledger.fromFiles(
		{
			'cashier.bean': `2000-01-01 open ${accountName} USD\n2000-01-01 open Expenses:Groceries USD\n${desktop}${source.repeat(copies)}`
		},
		'cashier.bean'
	);
	try {
		const result = ledger.query(
			`SELECT date, payee, narration, number, currency WHERE account = '${accountName}'`
		);
		expect(result.errors).toEqual([]);
		if (!payee) expect(result.rows.at(-1)?.[1]).toBeNull();
		mocks.query.mockResolvedValue(result);
		const balance = ledger.query(`SELECT sum(number) WHERE account = '${accountName}'`);
		const account = new Account(accountName);
		account.balances = { USD: Number(balance.rows[0][0]) };
		mocks.account.mockResolvedValue(account);
		const local = Array.from({ length: copies }, (_, index) => {
			const xact = new Xact();
			xact.date = '2026-11-06';
			xact.payee = payee;
			xact.note = narration;
			xact.postings = amounts.map((amount) =>
				Object.assign(new Posting(), {
					account: accountName,
					amount: Number(amount),
					amountText: typeof amount === 'string' ? amount : undefined,
					currency: 'USD'
				})
			);
			return { xact, span: { startLine: index * 5, endLine: index * 5 + 4, sourceText: source } };
		});
		mocks.getXactsWithSpans.mockResolvedValue(local);
		const response = load({ params: { accountName }, depends: vi.fn() } as unknown as Parameters<
			typeof load
		>[0]);
		const resolved = await response.history;
		expect(resolved.error).toBeNull();
		return { data: resolved.data!, local };
	} finally {
		ledger.free();
	}
}

test.each(['', 'QA Payee'])(
	'one local posting is shown once with payee %j and unchanged balance',
	async (payee) => {
		const { data, local } = await history(payee, [-3]);
		expect(data.account.balances).toEqual({ USD: -3 });
		expect(data.unifiedRows).toHaveLength(1);
		expect(data.unifiedRows[0]).toMatchObject({ payee, narration, amount: -3, isDevice: true });
		expect(data.unifiedRows[0].xact).toBe(local[0].xact);
		expect(data.unifiedRows[0].span).toBe(local[0].span);
	}
);

test('identical local transactions and split postings retain multiplicity and separate edit targets', async () => {
	const { data, local } = await history('', [-3, -3, -4], 2);
	expect(data.account.balances).toEqual({ USD: -20 });
	expect(data.unifiedRows).toHaveLength(6);
	expect(data.unifiedRows.every((row) => row.isDevice)).toBe(true);
	for (const entry of local) {
		const rows = data.unifiedRows.filter((row) => row.span === entry.span);
		expect(rows.map((row) => row.amount)).toEqual([-3, -3, -4]);
		expect(rows.every((row) => row.xact === entry.xact)).toBe(true);
	}
});

test('matching consumes only one occurrence and includes narration without suppressing desktop rows', async () => {
	const desktop = `2026-11-06 * "Other narration"\n  ${accountName} -3 USD\n  Expenses:Groceries 3 USD\n2026-11-06 * "${narration}"\n  ${accountName} -3 USD\n  Expenses:Groceries 3 USD\n`;
	const { data } = await history('', [-3], 1, desktop);
	expect(data.account.balances).toEqual({ USD: -9 });
	expect(data.unifiedRows).toHaveLength(3);
	expect(data.unifiedRows.filter((row) => row.isDevice)).toHaveLength(1);
	expect(data.unifiedRows.find((row) => row.narration === 'Other narration')?.isDevice).toBe(false);
	expect(data.unifiedRows.filter((row) => row.narration === narration)).toHaveLength(2);
});

test.each(['2.123456789', '1.23456789', '9007199254740993.123456789'])(
	'exact units %s survive local matching and restored ledger history',
	async (amountText) => {
		const { data, local } = await history('', [amountText]);
		expect(data.unifiedRows).toHaveLength(1);
		expect(data.unifiedRows[0]).toMatchObject({
			amount: Number(amountText),
			amountText,
			isDevice: true,
			xact: local[0].xact,
			span: local[0].span
		});

		mocks.getXactsWithSpans.mockResolvedValue([]);
		const restored = await load({
			params: { accountName },
			depends: vi.fn()
		} as unknown as Parameters<typeof load>[0]).history;
		expect(restored.error).toBeNull();
		expect(restored.data?.unifiedRows).toEqual([
			expect.objectContaining({ amount: Number(amountText), amountText, isDevice: false })
		]);
	}
);

test('matched and unmatched local rows use current exact posting text, not stale text after a numeric edit', async () => {
	const { data, local } = await history('', ['+1.2300']);
	expect(data.unifiedRows).toHaveLength(1);
	expect(data.unifiedRows[0]).toMatchObject({ amountText: '+1.2300', isDevice: true });

	mocks.query.mockResolvedValue({
		columns: ['date', 'payee', 'narration', 'number', 'currency'],
		rows: [],
		errors: []
	});
	const readHistory = async () =>
		(
			await load({ params: { accountName }, depends: vi.fn() } as unknown as Parameters<
				typeof load
			>[0]).history
		).data!.unifiedRows;
	expect(await readHistory()).toEqual([
		expect.objectContaining({ amountText: '+1.2300', isDevice: true, span: local[0].span })
	]);
	local[0].xact.postings[0].amount = 2.123456789;
	expect(await readHistory()).toEqual([
		expect.objectContaining({ amount: 2.123456789, amountText: undefined, isDevice: true })
	]);
});

test.each(['omitted', 'flagged'])(
	'real WASM %s postings retain one row per occurrence and valid neighboring rows',
	async (kind) => {
		const amountText = '1.0000000000000000001';
		const transaction =
			kind === 'omitted'
				? `2026-11-06 ! "${narration}"\n  ${accountName}\n  Expenses:Groceries\n`
				: `2026-11-06 ! "${narration}"\n  ! ${accountName} ${amountText} USD\n  Expenses:Groceries -${amountText} USD\n`;
		const valid = `2026-11-06 ! "${narration}"\n  ${accountName} 2.123456789 USD\n  Expenses:Groceries -2.123456789 USD\n`;
		mocks.source = transaction + transaction + valid;
		const { default: localService } = await vi.importActual<
			typeof import('#lib/services/ledgerService')
		>('#lib/services/ledgerService');
		const local = await localService.getXactsWithSpans();
		expect(local).toHaveLength(3);
		for (const entry of local.slice(0, 2)) {
			expect(entry.xact.postings[0].amountText).toBeUndefined();
			if (kind === 'flagged') {
				expect(entry.xact.postings[0]).toMatchObject({ amount: 1, sourceAnnotated: true });
			} else {
				expect(entry.xact.postings[0].amount).toBeUndefined();
			}
		}
		const ledger = Ledger.fromFiles(
			{
				'cashier.bean': `2000-01-01 open ${accountName} USD\n2000-01-01 open Expenses:Groceries USD\n${mocks.source}`
			},
			'cashier.bean'
		);
		try {
			const result = ledger.query(
				`SELECT date, payee, narration, number, currency WHERE account = '${accountName}'`
			);
			expect(result.errors).toEqual([]);
			expect(result.rows).toHaveLength(3);
			const numberIdx = result.columns.indexOf('number');
			const currencyIdx = result.columns.indexOf('currency');
			if (kind === 'omitted') {
				expect(
					result.rows.filter((row) => row[numberIdx] === null && row[currencyIdx] === null)
				).toHaveLength(2);
			} else {
				expect(result.rows.filter((row) => row[numberIdx] === amountText)).toHaveLength(2);
			}
			mocks.query.mockResolvedValue(result);
			mocks.account.mockResolvedValue(new Account(accountName));
			mocks.getXactsWithSpans.mockResolvedValue(local);
			const resolved = await load({
				params: { accountName },
				depends: vi.fn()
			} as unknown as Parameters<typeof load>[0]).history;
			expect(resolved.error).toBeNull();
			expect(resolved.data?.unifiedRows).toHaveLength(3);
			for (const entry of local) {
				const rows = resolved.data!.unifiedRows.filter((row) => row.span === entry.span);
				expect(rows).toHaveLength(1);
				expect(rows[0].xact).toBe(entry.xact);
				expect(rows[0].isDevice).toBe(true);
				if (entry === local[2]) {
					expect(rows[0].amountText).toBe('2.123456789');
				} else if (kind === 'omitted') {
					expect(Number.isNaN(rows[0].amount)).toBe(true);
					expect(rows[0].amountText).toBeUndefined();
					expect(rows[0].currency).toBe('');
				} else {
					expect(rows[0].amountText).toBe(amountText);
				}
			}
		} finally {
			ledger.free();
		}
	}
);

test('decimal matching distinguishes numeric collisions and preserves occurrence edit targets', async () => {
	const localAmount = '1.0000000000000000001';
	const desktopAmount = '1.0000000000000000002';
	expect(Number(localAmount)).toBe(Number(desktopAmount));
	const desktop = `2026-11-06 * "${narration}"\n  ${accountName} ${desktopAmount} USD\n  Expenses:Groceries -${desktopAmount} USD\n`;
	const { data, local } = await history('', [localAmount], 2, desktop);
	expect(data.unifiedRows).toHaveLength(3);
	expect(data.unifiedRows.filter((row) => !row.isDevice)).toEqual([
		expect.objectContaining({ amountText: desktopAmount })
	]);
	for (const entry of local) {
		expect(data.unifiedRows.filter((row) => row.span === entry.span)).toEqual([
			expect.objectContaining({ amountText: localAmount, isDevice: true, xact: entry.xact })
		]);
	}
});
