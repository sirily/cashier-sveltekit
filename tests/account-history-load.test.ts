import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import init, { Ledger } from '@rustledger/wasm';
import { Account, Xact, Posting } from '#lib/data/model';
import { load } from '../src/routes/accounts/account-xacts/[accountName]/+page';

const mocks = vi.hoisted(() => ({ query: vi.fn(), getXactsWithSpans: vi.fn(), account: vi.fn() }));
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

async function history(payee: string, amounts: number[], copies = 1, desktop = '') {
	const header = `2026-11-06 ! ${payee ? `"${payee}" ` : ''}"${narration}"`;
	const source = `${header}\n${amounts.map((amount) => `  ${accountName} ${amount} USD`).join('\n')}\n  Expenses:Groceries ${-amounts.reduce((sum, amount) => sum + amount, 0)} USD\n`;
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
				Object.assign(new Posting(), { account: accountName, amount, currency: 'USD' })
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
