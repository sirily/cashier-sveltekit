import { readFileSync } from 'node:fs';
import init, { ParsedLedger } from '@rustledger/wasm';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const SEQ_UUIDS = ['uuid-001', 'uuid-002', 'uuid-003', 'uuid-004'];

const mockState = vi.hoisted(() => {
	const opfsFiles = new Map<string, string>();
	return { opfsFiles, fetch: vi.fn() };
});

vi.stubGlobal('fetch', mockState.fetch);

vi.mock('#lib/utils/opfslib', () => ({
	readFile: vi.fn(async (path: string) => mockState.opfsFiles.get(path)),
	saveFile: vi.fn(async (path: string, content: string) => {
		mockState.opfsFiles.set(path, content);
	}),
	fileExists: vi.fn(async (path: string) => mockState.opfsFiles.has(path)),
	listFileTree: vi.fn(async () => {
		const entries: Array<{
			name: string;
			kind: 'file' | 'directory';
			path: string;
			depth: number;
		}> = [];
		for (const path of mockState.opfsFiles.keys()) {
			if (path === 'cashier.bean') continue;
			entries.push({ name: path.split('/').pop()!, kind: 'file', path, depth: 0 });
		}
		return entries;
	}),
	deleteFile: vi.fn(async (path: string) => {
		mockState.opfsFiles.delete(path);
		return true;
	})
}));

vi.mock('#lib/sync/journal-storage', () => ({
	readJournal: async () => mockState.opfsFiles.get('cashier.bean'),
	saveJournal: async (_expected: string, content: string) => {
		const opfs = await import('#lib/utils/opfslib');
		await opfs.saveFile('cashier.bean', content);
	}
}));

vi.mock('#lib/constants', () => ({
	CASHIER_XACT_FILE: 'cashier.bean'
}));

import {
	prepareLocalTransactions,
	pushTransactions,
	reconcileLocalJournalFromPaths
} from '#lib/sync/manual-writeback';
import type { PendingTransaction } from '#lib/sync/manual-writeback';

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});

function parsedConfirmation(paths: string[]): string[] {
	const source = paths
		.map((path) => mockState.opfsFiles.get(path) ?? '')
		.join('\n')
		.replace(/^include[^\r\n]*/gm, '');
	const parsed = new ParsedLedger(source);
	try {
		expect(parsed.getParseErrors()).toEqual([]);
		const result = parsed.query("SELECT DISTINCT entry_meta('cashier_id') WHERE flag = '*'");
		expect(result.errors).toEqual([]);
		return result.rows.flatMap((row) => (typeof row[0] === 'string' && row[0] ? [row[0]] : []));
	} finally {
		parsed.free();
	}
}

async function reconcileAcceptedLocal(rejectedIds: string[], paths: string[]): Promise<void> {
	const accepted = await prepareLocalTransactions();
	await reconcileLocalJournalFromPaths(rejectedIds, paths, {
		accepted,
		confirmedIds: parsedConfirmation(paths)
	});
}

let uuidSeqIndex = 0;

beforeEach(() => {
	vi.clearAllMocks();
	mockState.opfsFiles.clear();
	mockState.fetch.mockReset();
	uuidSeqIndex = 0;
	globalThis.crypto.randomUUID = () =>
		(SEQ_UUIDS[uuidSeqIndex++] ??
			`fallback-${uuidSeqIndex}`) as `${string}-${string}-${string}-${string}-${string}`;
	globalThis.fetch = mockState.fetch;
});

// ---------------------------------------------------------------------------
// prepareLocalTransactions
// ---------------------------------------------------------------------------

describe('prepareLocalTransactions', () => {
	test('returns empty when cashier.bean is empty', async () => {
		mockState.opfsFiles.set('cashier.bean', '');

		const result = await prepareLocalTransactions();

		expect(result).toEqual([]);
	});

	test('returns empty when no completed transactions exist', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			'2026-06-01 ! "Incomplete" "Not ready"\n    Expenses:Food  10 USD\n    Assets:Cash'
		);

		const result = await prepareLocalTransactions();

		expect(result).toEqual([]);
	});

	test('assigns cashier_id to completed transaction without one', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Supermarket" "Groceries"',
				'    Expenses:Food  12.50 USD',
				'    Assets:Cash'
			].join('\n')
		);

		const result = await prepareLocalTransactions();

		expect(result).toHaveLength(1);
		expect(result[0].cashierId).toBe('uuid-001');
		expect(result[0].rawText).toContain('cashier_id: "uuid-001"');

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('cashier_id: "uuid-001"');
		expect(saved).toContain('2026-06-01 * "Supermarket" "Groceries"');
		expect(saved).toContain('Expenses:Food  12.50 USD');
	});

	test('reuses existing cashier_id when present', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Supermarket" "Groceries"',
				'    cashier_id: "existing-uuid"',
				'    Expenses:Food  12.50 USD',
				'    Assets:Cash'
			].join('\n')
		);

		const result = await prepareLocalTransactions();

		expect(result).toHaveLength(1);
		expect(result[0].cashierId).toBe('existing-uuid');
		expect(result[0].rawText).toContain('cashier_id: "existing-uuid"');
		// File unchanged
		expect(mockState.opfsFiles.get('cashier.bean')).toContain('cashier_id: "existing-uuid"');
	});

	test('reuses existing cashier_id with nonstandard metadata indentation', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Supermarket" "Groceries"',
				'  cashier_id: "existing-uuid"',
				'  Expenses:Food  12.50 USD',
				'  Assets:Cash'
			].join('\n')
		);

		const result = await prepareLocalTransactions();

		expect(result).toHaveLength(1);
		expect(result[0].cashierId).toBe('existing-uuid');
		expect(mockState.opfsFiles.get('cashier.bean')).toContain('  cashier_id: "existing-uuid"');
	});

	test('does not persist if no new cashier_ids were assigned', async () => {
		const content =
			'2026-06-01 * "Supermarket" "Groceries"\n    cashier_id: "existing-uuid"\n    Expenses:Food  12.50 USD\n    Assets:Cash';
		mockState.opfsFiles.set('cashier.bean', content);

		const saveSpy = vi.spyOn(await import('#lib/utils/opfslib'), 'saveFile');

		await prepareLocalTransactions();
		// saveFile should NOT have been called since content didn't change
		expect(saveSpy).not.toHaveBeenCalled();
	});

	test('only returns completed * transactions, not incomplete !', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Done" "Synced"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'',
				'2026-06-02 ! "WIP" "Not ready"',
				'    Expenses:Food  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		const result = await prepareLocalTransactions();

		expect(result).toHaveLength(1);
		expect(result[0].cashierId).toBe('uuid-001');
		expect(result[0].rawText).toContain('"Done"');
	});

	test('handles multiple completed transactions', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "First" "Transaction"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'',
				'2026-06-02 * "Second" "Another"',
				'    Expenses:Transport  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		const result = await prepareLocalTransactions();

		expect(result).toHaveLength(2);
		expect(result[0].cashierId).toBe('uuid-001');
		expect(result[1].cashierId).toBe('uuid-002');
		expect(result[0].rawText).toContain('cashier_id: "uuid-001"');
		expect(result[1].rawText).toContain('cashier_id: "uuid-002"');
	});

	test('handles adjacent completed transactions without a blank separator', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "First" "Transaction"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'2026-06-02 * "Second" "Another"',
				'    Expenses:Transport  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		const result = await prepareLocalTransactions();

		expect(result).toHaveLength(2);
		expect(result[0].rawText).not.toContain('"Second"');
		expect(result[1].rawText).toContain('"Second"');
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(
			[
				'2026-06-01 * "First" "Transaction"',
				'    cashier_id: "uuid-001"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'2026-06-02 * "Second" "Another"',
				'    cashier_id: "uuid-002"',
				'    Expenses:Transport  5 USD',
				'    Assets:Cash'
			].join('\n')
		);
	});

	test('handles mixed existing and missing cashier_ids', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Existing" "Has ID"',
				'    cashier_id: "existing-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'',
				'2026-06-02 * "Missing" "Needs ID"',
				'    Expenses:Food  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		const result = await prepareLocalTransactions();

		expect(result).toHaveLength(2);
		expect(result[0].cashierId).toBe('existing-uuid');
		expect(result[1].cashierId).toBe('uuid-001');
	});

	test('preserves non-transaction content (comments, options)', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'; This is a comment',
				'option "title" "Test"',
				'',
				'2026-06-01 * "Test" "Xact"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await prepareLocalTransactions();

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('; This is a comment');
		expect(saved).toContain('option "title" "Test"');
	});
});

// ---------------------------------------------------------------------------
// pushTransactions
// ---------------------------------------------------------------------------

describe('pushTransactions', () => {
	const SERVER_URL = 'https://cashier.example.test/api';

	test('no transactions returns empty response without fetch', async () => {
		const result = await pushTransactions(SERVER_URL, []);

		expect(result).toEqual({ synchronized: [], rejected: [] });
		expect(mockState.fetch).not.toHaveBeenCalled();
	});

	test('POSTs transactions to /api/xact and returns response', async () => {
		const pending: PendingTransaction[] = [
			{
				rawText:
					'2026-06-01 * "Test" "Xact"\n    cashier_id: "uuid-001"\n    Expenses:Food  10 USD\n    Assets:Cash',
				cashierId: 'uuid-001'
			}
		];

		mockState.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				synchronized: ['uuid-001'],
				rejected: []
			})
		});

		const result = await pushTransactions(SERVER_URL, pending, 'secret-token');

		expect(result).toEqual({ synchronized: ['uuid-001'], rejected: [] });
		expect(mockState.fetch).toHaveBeenCalledTimes(1);
		expect(mockState.fetch).toHaveBeenCalledWith(
			'https://cashier.example.test/api/xact',
			expect.objectContaining({
				method: 'POST',
				headers: {
					Authorization: ['Bearer', 'secret-token'].join(' '),
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					transactions: [pending[0].rawText]
				})
			})
		);
	});

	test('POSTs multiple transactions in batch', async () => {
		const pending: PendingTransaction[] = [
			{ rawText: 'xact1', cashierId: 'uuid-001' },
			{ rawText: 'xact2', cashierId: 'uuid-002' }
		];

		mockState.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				synchronized: ['uuid-001'],
				rejected: [{ cashier_id: 'uuid-002', reason: 'Invalid account' }]
			})
		});

		const result = await pushTransactions(SERVER_URL, pending);

		expect(result.synchronized).toEqual(['uuid-001']);
		expect(result.rejected).toEqual([{ cashier_id: 'uuid-002', reason: 'Invalid account' }]);
	});

	test('throws on non-ok response', async () => {
		const pending: PendingTransaction[] = [{ rawText: 'xact1', cashierId: 'uuid-001' }];

		mockState.fetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			text: async () => 'Server error'
		});

		await expect(pushTransactions(SERVER_URL, pending)).rejects.toThrow(
			/Sending local transactions: HTTP 500/
		);
	});

	test('trims trailing slash from server URL', async () => {
		const pending: PendingTransaction[] = [{ rawText: 'xact1', cashierId: 'uuid-001' }];

		mockState.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ synchronized: ['uuid-001'], rejected: [] })
		});

		await pushTransactions('https://cashier.example.test/api/', pending);

		expect(mockState.fetch).toHaveBeenCalledWith(
			'https://cashier.example.test/api/xact',
			expect.any(Object)
		);
	});

	test('adds /api/xact when server URL does not include api prefix', async () => {
		const pending: PendingTransaction[] = [{ rawText: 'xact1', cashierId: 'uuid-001' }];

		mockState.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ synchronized: ['uuid-001'], rejected: [] })
		});

		await pushTransactions('https://cashier.example.test', pending);

		expect(mockState.fetch).toHaveBeenCalledWith(
			'https://cashier.example.test/api/xact',
			expect.any(Object)
		);
	});
});

// ---------------------------------------------------------------------------
// reconcileLocalJournal
// ---------------------------------------------------------------------------

describe('reconcileLocalJournal', () => {
	const MAIN_BEAN = ['include "accounts.bean"', 'include "manual_transactions.bean"'].join('\n');

	const ACCOUNTS_BEAN = '2026-01-01 open Assets:Cash';

	const MANUAL_BEAN = [
		'2026-06-01 * "Synced" "One"',
		'    cashier_id: "synced-uuid-1"',
		'    Expenses:Food  10 USD',
		'    Assets:Cash'
	].join('\n');

	beforeEach(() => {
		// Set up pulled ledger files
		mockState.opfsFiles.set('main.bean', MAIN_BEAN);
		mockState.opfsFiles.set('accounts.bean', ACCOUNTS_BEAN);
		mockState.opfsFiles.set('manual_transactions.bean', MANUAL_BEAN);
	});

	test('removes local transaction whose cashier_id appears in pulled ledger', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Synced" "One"',
				'    cashier_id: "synced-uuid-1"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean']);

		// The synced transaction should be removed from cashier.bean
		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).not.toContain('synced-uuid-1');
		expect(saved?.trim()).toBe('');
	});

	test('keeps local transaction when rejected in current push batch', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Rejected" "Bad"',
				'    cashier_id: "rejected-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal(
			['rejected-uuid'],
			['main.bean', 'accounts.bean', 'manual_transactions.bean']
		);

		// Even though the pulled ledger has this ID (manual_transactions.bean),
		// we keep it because it was rejected in this batch
		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('rejected-uuid');
	});

	test('keeps local transaction whose cashier_id is not in pulled ledger', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Local" "Not synced"',
				'    cashier_id: "local-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('local-uuid');
		expect(saved).toContain('"Local"');
	});

	test('keeps incomplete ! transactions even if they have cashier_id in ledger', async () => {
		// Manual transactions bean includes both a * and a ! with cashier_id
		mockState.opfsFiles.set(
			'manual_transactions.bean',
			[
				'2026-06-01 * "Synced" "Done"',
				'    cashier_id: "star-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'',
				'2026-06-01 ! "Incomplete" "WIP"',
				'    cashier_id: "bang-uuid"',
				'    Expenses:Food  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Synced" "Done"',
				'    cashier_id: "star-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'',
				'2026-06-01 ! "Incomplete" "WIP"',
				'    cashier_id: "bang-uuid"',
				'    Expenses:Food  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		// The * transaction should be removed (it's completed and synced)
		expect(saved).not.toContain('star-uuid');
		// The ! transaction should remain (reconcile only removes * transactions)
		expect(saved).toContain('bang-uuid');
	});

	test('handles no local transactions gracefully', async () => {
		mockState.opfsFiles.set('cashier.bean', '');

		// Should not throw
		await expect(
			reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean'])
		).resolves.toBeUndefined();
	});

	test('handles missing cashier.bean gracefully', async () => {
		await expect(
			reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean'])
		).resolves.toBeUndefined();
	});

	test('mixed batch: removes synced, keeps rejected', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Good" "Valid"',
				'    cashier_id: "good-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'',
				'2026-06-02 * "Bad" "Invalid"',
				'    cashier_id: "bad-uuid"',
				'    Expenses:Fake  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		// Pulled ledger has good-uuid but not bad-uuid
		mockState.opfsFiles.delete('manual_transactions.bean');
		mockState.opfsFiles.set(
			'manual_transactions.bean',
			[
				'2026-06-01 * "Good" "Valid"',
				'    cashier_id: "good-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal(
			['bad-uuid'],
			['main.bean', 'accounts.bean', 'manual_transactions.bean']
		);

		const saved = mockState.opfsFiles.get('cashier.bean');
		// good-uuid is in pulled ledger and not rejected → removed
		expect(saved).not.toContain('good-uuid');
		// bad-uuid is rejected → stays local
		expect(saved).toContain('bad-uuid');
	});

	test('removes only the synced adjacent transaction when there is no blank separator', async () => {
		mockState.opfsFiles.set(
			'manual_transactions.bean',
			[
				'2026-06-01 * "Synced" "Gone"',
				'    cashier_id: "synced-adjacent"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Synced" "Gone"',
				'    cashier_id: "synced-adjacent"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'2026-06-02 * "Local" "Still here"',
				'    cashier_id: "local-adjacent"',
				'    Expenses:Transport  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).not.toContain('synced-adjacent');
		expect(saved).toContain('local-adjacent');
		expect(saved).toContain('"Local"');
	});

	test('ignores cashier_id values outside completed transactions in pulled ledger files', async () => {
		mockState.opfsFiles.set(
			'manual_transactions.bean',
			[
				'; cashier_id: "comment-only"',
				'2026-06-01 ! "Incomplete" "Not confirmed"',
				'    cashier_id: "incomplete-only"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Comment match" "Must stay"',
				'    cashier_id: "comment-only"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash',
				'',
				'2026-06-02 * "Incomplete match" "Must stay"',
				'    cashier_id: "incomplete-only"',
				'    Expenses:Food  5 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('comment-only');
		expect(saved).toContain('incomplete-only');
	});

	test('keeps local IDs that are only in cashier.bean, not in pulled ledger', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Not pushed" "Still local"',
				'    cashier_id: "never-pushed"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		// Pulled ledger has no non-cashier .bean files with this ID
		mockState.opfsFiles.delete('manual_transactions.bean');

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('never-pushed');
	});

	test('ignores stale OPFS files outside the current pulled ledger path set', async () => {
		mockState.opfsFiles.set(
			'stale/manual_transactions.bean',
			[
				'2026-06-01 * "Stale" "Old root"',
				'    cashier_id: "stale-only"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-01 * "Local" "Must stay"',
				'    cashier_id: "stale-only"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('stale-only');
		expect(saved).toContain('"Must stay"');
	});

	test('preserves non-transaction content in cashier.bean after reconciliation', async () => {
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'; User comment',
				'option "title" "Test"',
				'',
				'2026-06-01 * "Synced" "Gone"',
				'    cashier_id: "synced-uuid-1"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);

		await reconcileAcceptedLocal([], ['main.bean', 'accounts.bean', 'manual_transactions.bean']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('; User comment');
		expect(saved).toContain('option "title" "Test"');
	});
});

describe('POST response validation', () => {
	test.each([
		null,
		[],
		{},
		{ synchronized: [] },
		{ rejected: [] },
		{ synchronized: null, rejected: [] },
		{ synchronized: [42], rejected: [] },
		{ synchronized: [''], rejected: [] },
		{ synchronized: [], rejected: null },
		{ synchronized: [], rejected: [null] },
		{ synchronized: [], rejected: [{ cashier_id: 'id' }] },
		{ synchronized: [], rejected: [{ cashier_id: 42, reason: 'Conflict' }] },
		{ synchronized: [], rejected: [{ cashier_id: 'id', reason: '' }] }
	])('rejects malformed success body %j as unresolved', async (body) => {
		mockState.fetch.mockResolvedValueOnce({ ok: true, json: async () => body });
		await expect(
			pushTransactions('https://cashier.test', [{ cashierId: 'id', rawText: 'raw' }])
		).rejects.toThrow(/malformed response; send outcomes are unresolved/);
	});

	test('preserves concrete unattributed rejection reasons', async () => {
		const body = {
			synchronized: [],
			rejected: [{ cashier_id: null, reason: 'Cannot validate batch' }]
		};
		mockState.fetch.mockResolvedValueOnce({ ok: true, json: async () => body });
		expect(
			await pushTransactions('https://cashier.test', [{ cashierId: 'id', rawText: 'raw' }])
		).toEqual(body);
	});

	test('does not manufacture acceptance for omitted outcomes', async () => {
		mockState.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ synchronized: [], rejected: [] })
		});
		expect(
			await pushTransactions('https://cashier.test', [{ cashierId: 'id', rawText: 'raw' }])
		).toEqual({ synchronized: [], rejected: [] });
	});

	test('propagates undecodable JSON as an unresolved send failure', async () => {
		mockState.fetch.mockResolvedValueOnce({
			ok: true,
			json: async () => {
				throw new SyntaxError('Invalid JSON');
			}
		});
		await expect(
			pushTransactions('https://cashier.test', [{ cashierId: 'id', rawText: 'raw' }])
		).rejects.toThrow('Invalid JSON');
	});
});

describe('parsed confirmation and accepted-source safeguards', () => {
	const rawText =
		'2026-06-01 * "Accepted" "Original"\n  cashier_id: "accepted-id"\n  Expenses:Food  3 ITEM @@ 10.01 USD\n  Assets:Cash  -10.01 USD';
	const accepted = [{ cashierId: 'accepted-id', rawText }];
	const draft =
		'2026-06-02 ! "Draft" "Exact bytes"\n\tcashier_id: "draft-id"\n\tExpenses:Food  5 USD\n\tAssets:Cash\n';

	test('removes only unchanged accepted and confirmed completed source; never reads raw server files', async () => {
		mockState.opfsFiles.set('cashier.bean', rawText + '\n\n' + draft);
		// The runtime confirmation is authoritative even when OPFS raw text differs.
		const read = vi.mocked((await import('#lib/utils/opfslib')).readFile);
		await reconcileLocalJournalFromPaths([], ['unreadable.bean'], {
			accepted,
			confirmedIds: ['accepted-id', 'draft-id']
		});
		expect(mockState.opfsFiles.get('cashier.bean')).toBe('\n\n' + draft);
		expect(read).not.toHaveBeenCalled();
	});

	test.each([
		{ accepted: [], confirmedIds: ['accepted-id'] },
		{ accepted, confirmedIds: [] },
		{ accepted: [{ cashierId: 'other-id', rawText }], confirmedIds: ['accepted-id'] },
		{
			accepted: [{ cashierId: 'accepted-id', rawText: rawText.replace('Original', 'Older') }],
			confirmedIds: ['accepted-id']
		}
	])('retains unresolved, unconfirmed, or different accepted source %j', async (confirmation) => {
		mockState.opfsFiles.set('cashier.bean', rawText + '\n\n' + draft);
		mockState.opfsFiles.set('server.bean', rawText);
		await reconcileLocalJournalFromPaths([], ['server.bean'], confirmation);
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(rawText + '\n\n' + draft);
	});

	test('rejection vetoes an otherwise accepted and confirmed match', async () => {
		mockState.opfsFiles.set('cashier.bean', rawText);
		await reconcileLocalJournalFromPaths(['accepted-id'], [], {
			accepted,
			confirmedIds: ['accepted-id']
		});
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(rawText);
	});

	test('keeps a same-ID edit, a completion-flag change, and a new append made after sending', async () => {
		for (const changed of [rawText.replace('Original', 'Edited'), rawText.replace(' * ', ' ! ')]) {
			mockState.opfsFiles.set('cashier.bean', changed + '\n\n' + draft);
			await reconcileLocalJournalFromPaths([], [], {
				accepted,
				confirmedIds: ['accepted-id', 'draft-id']
			});
			expect(mockState.opfsFiles.get('cashier.bean')).toBe(changed + '\n\n' + draft);
		}
	});

	test('an append before reconciliation survives removal of the original accepted entry', async () => {
		const appended = rawText.replaceAll('accepted-id', 'new-id').replace('Original', 'Appended');
		mockState.opfsFiles.set('cashier.bean', rawText + '\n\n' + appended + '\n\n' + draft);
		await reconcileLocalJournalFromPaths([], [], {
			accepted,
			confirmedIds: ['accepted-id', 'new-id']
		});
		expect(mockState.opfsFiles.get('cashier.bean')).toBe('\n\n' + appended + '\n\n' + draft);
	});

	test('a non-transaction directive after a removed transaction remains byte-for-byte intact', async () => {
		const tail =
			'\n\n; Keep comment\n2026-06-02 balance Assets:Cash  99 USD\n  cashier_id: "not-a-transaction"\n';
		mockState.opfsFiles.set('cashier.bean', rawText + tail);
		await reconcileLocalJournalFromPaths([], [], { accepted, confirmedIds: ['accepted-id'] });
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(tail);
	});

	test('missing confirmation fails closed without reading stale OPFS files', async () => {
		mockState.opfsFiles.set('cashier.bean', rawText);
		mockState.opfsFiles.set('stale.bean', rawText);
		// @ts-expect-error Exercise an untyped caller omitting required confirmation.
		await expect(reconcileLocalJournalFromPaths([], undefined)).rejects.toThrow(
			/requires explicit acceptance/
		);
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(rawText);
		expect((await import('#lib/utils/opfslib')).listFileTree).not.toHaveBeenCalled();
	});
});
