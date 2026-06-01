import { beforeEach, describe, expect, test, vi } from 'vitest';

const SEQ_UUIDS = ['uuid-001', 'uuid-002', 'uuid-003', 'uuid-004'];

const mockState = vi.hoisted(() => {
	const opfsFiles = new Map<string, string>();
	return { opfsFiles, fetch: vi.fn() };
});

vi.stubGlobal('fetch', mockState.fetch);

vi.mock('$lib/utils/opfslib', () => ({
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

vi.mock('$lib/constants', () => ({
	CASHIER_XACT_FILE: 'cashier.bean'
}));

import {
	prepareLocalTransactions,
	pushTransactions,
	reconcileLocalJournal
} from '$lib/sync/manual-writeback';
import type { PendingTransaction } from '$lib/sync/manual-writeback';

let uuidSeqIndex = 0;

beforeEach(() => {
	mockState.opfsFiles.clear();
	mockState.fetch.mockReset();
	uuidSeqIndex = 0;
	globalThis.crypto.randomUUID = () =>
		(SEQ_UUIDS[uuidSeqIndex++] ?? `fallback-${uuidSeqIndex}`) as `${string}-${string}-${string}-${string}-${string}`;
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

	test('does not persist if no new cashier_ids were assigned', async () => {
		const content =
			'2026-06-01 * "Supermarket" "Groceries"\n    cashier_id: "existing-uuid"\n    Expenses:Food  12.50 USD\n    Assets:Cash';
		mockState.opfsFiles.set('cashier.bean', content);

		const saveSpy = vi.spyOn(
			await import('$lib/utils/opfslib'),
			'saveFile'
		);

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

	test('POSTs transactions to /xact and returns response', async () => {
		const pending: PendingTransaction[] = [
			{
				rawText: '2026-06-01 * "Test" "Xact"\n    cashier_id: "uuid-001"\n    Expenses:Food  10 USD\n    Assets:Cash',
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

		const result = await pushTransactions(SERVER_URL, pending);

		expect(result).toEqual({ synchronized: ['uuid-001'], rejected: [] });
		expect(mockState.fetch).toHaveBeenCalledTimes(1);
		expect(mockState.fetch).toHaveBeenCalledWith(
			'https://cashier.example.test/api/xact',
			expect.objectContaining({
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
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
		const pending: PendingTransaction[] = [
			{ rawText: 'xact1', cashierId: 'uuid-001' }
		];

		mockState.fetch.mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: 'Internal Server Error',
			text: async () => 'Server error'
		});

		await expect(pushTransactions(SERVER_URL, pending)).rejects.toThrow(
			/Server rejected request/
		);
	});

	test('trims trailing slash from server URL', async () => {
		const pending: PendingTransaction[] = [
			{ rawText: 'xact1', cashierId: 'uuid-001' }
		];

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
});

// ---------------------------------------------------------------------------
// reconcileLocalJournal
// ---------------------------------------------------------------------------

describe('reconcileLocalJournal', () => {
	const MAIN_BEAN = [
		'include "accounts.bean"',
		'include "manual_transactions.bean"'
	].join('\n');

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

		await reconcileLocalJournal([]);

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

		await reconcileLocalJournal(['rejected-uuid']);

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

		await reconcileLocalJournal([]);

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

		await reconcileLocalJournal([]);

		const saved = mockState.opfsFiles.get('cashier.bean');
		// The * transaction should be removed (it's completed and synced)
		expect(saved).not.toContain('star-uuid');
		// The ! transaction should remain (reconcile only removes * transactions)
		expect(saved).toContain('bang-uuid');
	});

	test('handles no local transactions gracefully', async () => {
		mockState.opfsFiles.set('cashier.bean', '');

		// Should not throw
		await expect(reconcileLocalJournal([])).resolves.toBeUndefined();
	});

	test('handles missing cashier.bean gracefully', async () => {
		await expect(reconcileLocalJournal([])).resolves.toBeUndefined();
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

		await reconcileLocalJournal(['bad-uuid']);

		const saved = mockState.opfsFiles.get('cashier.bean');
		// good-uuid is in pulled ledger and not rejected → removed
		expect(saved).not.toContain('good-uuid');
		// bad-uuid is rejected → stays local
		expect(saved).toContain('bad-uuid');
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

		await reconcileLocalJournal([]);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('never-pushed');
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

		await reconcileLocalJournal([]);

		const saved = mockState.opfsFiles.get('cashier.bean');
		expect(saved).toContain('; User comment');
		expect(saved).toContain('option "title" "Test"');
	});
});
