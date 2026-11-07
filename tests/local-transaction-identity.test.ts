import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import init, { ParsedLedger } from '@rustledger/wasm';

const state = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('#lib/utils/opfslib', () => ({
	readFile: vi.fn(async (path: string) => state.files.get(path)),
	saveFile: async (path: string, content: string) => {
		state.files.set(path, content);
	}
}));
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

import ledgerService from '#lib/services/ledgerService';
import * as opfslib from '#lib/utils/opfslib';
import appService from '#lib/services/appService';
import { Xact } from '#lib/data/model';
import { xactToBeancountText } from '#lib/utils/xactUtils';
import { prepareLocalTransactions, pushTransactions } from '#lib/sync/manual-writeback';

const prefix = '2000-01-01 open Assets:Cash USD\n2000-01-01 open Expenses:Food USD\n';
const transaction =
	'2025-01-01 * "Cafe" "Original"\n  cashier_id: "existing-local-id"\n  Expenses:Food  12.50 USD\n  Assets:Cash  -12.50 USD\n';
const neighbor =
	'\n2025-01-02 ! "Neighbor" "Untouched"\n  cashier_id: "neighbor-id"\n  Expenses:Food  3 USD\n  Assets:Cash  -3 USD\n';

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});
beforeEach(() => {
	state.files.set('cashier.bean', prefix + transaction + neighbor);
});
afterEach(() => {
	ledgerService.free();
	vi.unstubAllGlobals();
	vi.mocked(opfslib.readFile).mockClear();
});

async function edit(note: string) {
	const [{ xact, span }] = await ledgerService.getXactsWithSpans();
	const editorModel = JSON.parse(JSON.stringify(xact));
	editorModel.note = note;
	await ledgerService.editTransaction(span, xactToBeancountText(editorModel));
}

function persistedIds() {
	const parsed = new ParsedLedger(state.files.get('cashier.bean')!);
	try {
		expect(parsed.getParseErrors()).toEqual([]);
		return [...state.files.get('cashier.bean')!.matchAll(/^[ \t]+cashier_id:\s*"([^"]*)"/gm)].map(
			(match) => match[1]
		);
	} finally {
		parsed.free();
	}
}

test('local editor save and reopen preserve existing identity and neighboring source', async () => {
	const network = vi.fn();
	vi.stubGlobal('fetch', network);
	await edit('Edited');
	const saved = state.files.get('cashier.bean')!;
	expect(saved.startsWith(prefix)).toBe(true);
	expect(saved.endsWith(neighbor)).toBe(true);
	expect(persistedIds()).toEqual(['existing-local-id', 'neighbor-id']);
	const reopened = await ledgerService.getXactsWithSpans();
	expect(reopened).toHaveLength(2);
	expect(reopened[0].xact.note).toBe('Edited');
	await edit('Edited twice');
	expect(persistedIds()).toEqual(['existing-local-id', 'neighbor-id']);
	expect(await prepareLocalTransactions()).toEqual([
		expect.objectContaining({ cashierId: 'existing-local-id' })
	]);
	expect(network).not.toHaveBeenCalled();
});

test('edit after accepted send with no pull retries the same identity and exposes a server conflict', async () => {
	const network = vi
		.fn()
		.mockResolvedValueOnce(
			new Response(JSON.stringify({ synchronized: ['existing-local-id'], rejected: [] }))
		)
		.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					synchronized: [],
					rejected: [{ cashier_id: 'existing-local-id', reason: 'Same ID with changed content' }]
				})
			)
		);
	vi.stubGlobal('fetch', network);
	await pushTransactions('https://cashier.test/api', await prepareLocalTransactions());
	// No downloaded snapshot: the accepted local entry remains available for editing.
	await edit('Edited after acceptance');
	const retry = await prepareLocalTransactions();
	expect(retry[0].cashierId).toBe('existing-local-id');
	expect(retry[0].rawText).toContain('Edited after acceptance');
	const response = await pushTransactions('https://cashier.test/api', retry);
	expect(response.rejected).toEqual([
		{ cashier_id: 'existing-local-id', reason: 'Same ID with changed content' }
	]);
	expect(persistedIds()).toEqual(['existing-local-id', 'neighbor-id']);
});

test.each(['  ;https://example.com/receipt', '  active:TRUE', '  account:Assets:Cash'])(
	'preserves identity after transaction annotation %s',
	async (annotation) => {
		state.files.set(
			'cashier.bean',
			prefix + transaction.replace('  cashier_id:', `${annotation}\n  cashier_id:`) + neighbor
		);
		await edit('Edited annotation');
		expect(persistedIds()).toEqual(['existing-local-id', 'neighbor-id']);
	}
);

test('ignores apparent identity lines inside multiline narration', async () => {
	state.files.set(
		'cashier.bean',
		prefix +
			'2025-01-01 * "Cafe" "Note\n  cashier_id: " ; "not-metadata"\n  cashier_id: "existing-local-id"\n  Expenses:Food  1 USD\n  Assets:Cash  -1 USD\n'
	);
	await edit('Edited multiline note');
	expect(persistedIds()).toEqual(['existing-local-id']);
	expect(state.files.get('cashier.bean')).toContain('; "not-metadata"');
});

test.each(['Expenses:Food', 'Expenses:Еда', 'Expenses:食物', 'Expenses:Épicerie'])(
	'does not promote posting metadata on %s to a transaction identity',
	async (account) => {
		state.files.set(
			'cashier.bean',
			prefix +
				`2025-01-01 * "Cafe" "Posting identity"\n  ${account}  1 USD\n    cashier_id: "posting-only-id"\n  Assets:Cash  -1 USD\n`
		);
		await edit('Edited');
		const pending = await prepareLocalTransactions();
		expect(pending[0].cashierId).not.toBe('posting-only-id');
	}
);

const annotatedTransaction =
	'2025-01-01 * "Cafe" "Original" #groceries ^receipt-123 ; header comment\n' +
	'  custom: "keep metadata"\n  cashier_id: "existing-local-id"\n' +
	'  ; transaction comment\n' +
	'  Expenses:Food  12.50 USD ; posting comment\n    category: "lunch"\n' +
	'  Assets:Cash  -12.50 USD\n';

test('RC95 no-op editor save preserves all source constructs byte for byte', async () => {
	const source = prefix + annotatedTransaction + neighbor;
	state.files.set('cashier.bean', source);
	await edit('Original');
	expect(state.files.get('cashier.bean')).toBe(source);
});

test('RC95 narration edits preserve metadata, tags, links and posting comments', async () => {
	state.files.set('cashier.bean', prefix + annotatedTransaction + neighbor);
	await edit('Edited');
	expect(state.files.get('cashier.bean')).toBe(
		prefix + annotatedTransaction.replace('"Original"', '"Edited"') + neighbor
	);
	await edit('Edited again');
	expect(state.files.get('cashier.bean')).toBe(
		prefix + annotatedTransaction.replace('"Original"', '"Edited again"') + neighbor
	);
});

test('unsafe annotated posting edits reject without changing source', async () => {
	const source = prefix + annotatedTransaction + neighbor;
	state.files.set('cashier.bean', source);
	const [{ xact, span }] = await ledgerService.getXactsWithSpans();
	xact.postings.reverse();
	await expect(ledgerService.editTransaction(span, xactToBeancountText(xact))).rejects.toThrow(
		/annotat|source editor/i
	);
	expect(state.files.get('cashier.bean')).toBe(source);
});

test('save rejects a journal change observed between reads without overwriting its neighbor', async () => {
	const [{ xact, span }] = await ledgerService.getXactsWithSpans();
	xact.note = 'Edited';
	const original = state.files.get('cashier.bean')!;
	const appended = original + '\n2025-01-03 ! "Concurrent addition"\n  Expenses:Food\n';
	vi.mocked(opfslib.readFile)
		.mockImplementationOnce(async () => original)
		.mockImplementationOnce(async () => {
			state.files.set('cashier.bean', appended);
			return appended;
		});
	await expect(ledgerService.editTransaction(span, xactToBeancountText(xact))).rejects.toThrow(
		/journal changed/i
	);
	expect(state.files.get('cashier.bean')).toBe(appended);
});

test('new and duplicated transactions receive identities independent of the edited original', async () => {
	await edit('Edited');
	const [{ xact }] = await ledgerService.getXactsWithSpans();
	await ledgerService.appendTransaction(xactToBeancountText(appService.createXactFrom(xact)));
	const fresh = Xact.create();
	fresh.note = 'New operation';
	fresh.postings = xact.postings;
	await ledgerService.appendTransaction(xactToBeancountText(fresh));
	const pending = await prepareLocalTransactions();
	expect(pending).toHaveLength(3);
	expect(pending[0].cashierId).toBe('existing-local-id');
	expect(new Set(pending.map((p) => p.cashierId)).size).toBe(3);
	expect((await prepareLocalTransactions()).map((p) => p.cashierId)).toEqual(
		pending.map((p) => p.cashierId)
	);
});
