import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import init, { ParsedLedger } from '@rustledger/wasm';

const state = vi.hoisted(() => ({ source: '', writes: vi.fn() }));
vi.mock('#lib/utils/opfslib', () => ({
	readFile: async () => state.source,
	saveFile: async (_path: string, source: string) => {
		state.writes(source);
		state.source = source;
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
import { mapDirectiveSpans } from '#lib/rledger/sourceEditor';
import { xactToBeancountText } from '#lib/utils/xactUtils';

const refund =
	'2026-11-06 * "QA-RC93-refund"\n  Assets:Physical:Cash 3 USD\n  Expenses:Groceries -3 USD';
const income =
	'2026-11-06 * "QA-RC93-income"\n  Assets:Physical:Cash 100 USD\n  Income:Salary -100 USD';
const prior =
	'2026-10-31 ! "QA-RC93-prior"\n  Assets:Physical:Cash -7 USD\n  Expenses:Groceries 7 USD';
const unsorted = `${refund}\n\n${income}\n\n${prior}\n`;

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});
beforeEach(() => {
	state.source = unsorted;
	state.writes.mockClear();
});
afterEach(() => ledgerService.free());

test('real WASM directives are date sorted but document symbols are in source order', () => {
	const ledger = new ParsedLedger(unsorted);
	try {
		expect(ledger.getParseErrors()).toEqual([]);
		expect(
			ledger
				.getDirectives()
				.filter((d) => d.type === 'transaction')
				.map((d) => d.narration)
		).toEqual(['QA-RC93-prior', 'QA-RC93-refund', 'QA-RC93-income']);
		expect(mapDirectiveSpans(unsorted, ledger).map((s) => s.sourceText)).toEqual([
			refund,
			income,
			prior
		]);
	} finally {
		ledger.free();
	}
});

test.each([
	'',
	'2000-01-01 open Assets:Physical:Cash USD\n2000-01-01 open Expenses:Groceries USD\n2000-01-01 open Income:Salary USD\n\n'
])('RC93 edit replaces only the selected refund, with infrastructure %j', async (prefix) => {
	state.source = prefix + unsorted;
	const entries = await ledgerService.getXactsWithSpans();
	const { xact, span } = entries.find((e) => e.xact.note === 'QA-RC93-refund')!;
	expect(xact.postings.map((p) => p.amount)).toEqual([3, -3]);
	xact.note = 'QA-RC93-edit-target';
	await ledgerService.editTransaction(span, xactToBeancountText(xact));
	expect(state.source).toBe(prefix + unsorted.replace('QA-RC93-refund', 'QA-RC93-edit-target'));
	expect((await ledgerService.getXactsWithSpans()).map((e) => e.xact.note).sort()).toEqual([
		'QA-RC93-edit-target',
		'QA-RC93-income',
		'QA-RC93-prior'
	]);
});

test('each listed transaction maps to its own span, including identical same-day entries', async () => {
	state.source = `${refund}\n\n${income}\n\n${refund}\n\n${prior}\n`;
	const entries = await ledgerService.getXactsWithSpans();
	expect(entries).toHaveLength(4);
	for (const { xact, span } of entries) {
		const parsed = new ParsedLedger(span.sourceText);
		try {
			const [directive] = parsed.getDirectives();
			expect(directive).toMatchObject({
				type: 'transaction',
				date: xact.date,
				narration: xact.note
			});
		} finally {
			parsed.free();
		}
	}
	const duplicates = entries.filter((e) => e.xact.note === 'QA-RC93-refund');
	expect(duplicates.map((e) => e.span.startLine)).toEqual([0, 8]);
	await ledgerService.deleteTransaction(duplicates[1].span);
	expect(state.source).toBe(`${refund}\n\n${income}\n\n\n\n${prior}\n`);
});

test('RC93 delete removes only the selected refund', async () => {
	const { span } = (await ledgerService.getXactsWithSpans()).find(
		(e) => e.xact.note === 'QA-RC93-refund'
	)!;
	await ledgerService.deleteTransaction(span);
	expect(state.source.trimStart()).toBe(`${income}\n\n${prior}\n`);
});

test.each(['edit', 'delete'] as const)(
	'%s rejects a stale captured span without writing',
	async (operation) => {
		state.source = `${refund}\n\n${income}\n`;
		const [{ span }] = await ledgerService.getXactsWithSpans();
		state.source = `${income}\n\n${refund}\n`;
		const before = state.source;
		const action =
			operation === 'edit'
				? ledgerService.editTransaction(span, prior)
				: ledgerService.deleteTransaction(span);
		await expect(action).rejects.toThrow(/source|reload|stale/i);
		expect(state.source).toBe(before);
		expect(state.writes).not.toHaveBeenCalled();
	}
);

test.each(['edit', 'delete'] as const)(
	'%s preserves a following comment, option, and blank lines',
	async (operation) => {
		const suffix =
			'\n; untouched neighbor comment\n\n\noption "title" "Local journal"\n\n' + income + '\n';
		state.source = refund + suffix;
		const [{ span }] = await ledgerService.getXactsWithSpans();
		expect(span.sourceText).toBe(refund);
		if (operation === 'edit') await ledgerService.editTransaction(span, prior);
		else await ledgerService.deleteTransaction(span);
		expect(state.source).toBe((operation === 'edit' ? prior : '') + suffix);
	}
);

test.each(['edit', 'delete'] as const)(
	'%s rejects unknown and non-transaction spans without writing',
	async (operation) => {
		state.source = '2000-01-01 open Assets:Physical:Cash USD\n\n' + refund + '\n';
		const parsed = new ParsedLedger(state.source);
		let spans;
		try {
			spans = mapDirectiveSpans(state.source, parsed);
		} finally {
			parsed.free();
		}
		const before = state.source;
		for (const span of [spans[0], { ...spans[1], startLine: 999 }, { ...spans[1], endLine: 999 }]) {
			const action =
				operation === 'edit'
					? ledgerService.editTransaction(span, prior)
					: ledgerService.deleteTransaction(span);
			await expect(action).rejects.toThrow(/source|reload/i);
			expect(state.source).toBe(before);
		}
		expect(state.writes).not.toHaveBeenCalled();
	}
);

test.each(['edit', 'delete'] as const)(
	'unfinished draft remains listable and supports %s despite interpolation errors',
	async (operation) => {
		const draft = '2026-11-06 ! "draft"\n  Assets:Cash\n  Expenses:Food';
		state.source = draft + '\n\n' + prior + '\n';
		const parsed = new ParsedLedger(state.source);
		try {
			expect(parsed.getParseErrors().some((e) => e.message.includes('interpolation'))).toBe(true);
			expect(parsed.getDirectives().filter((d) => d.type === 'transaction')).toHaveLength(2);
		} finally {
			parsed.free();
		}
		const entries = await ledgerService.getXactsWithSpans();
		const entry = entries.find((e) => e.xact.note === 'draft')!;
		expect(entry.span.sourceText).toBe(draft);
		expect(entry.xact.flag).toBe('!');
		expect(entry.xact.postings.map((p) => p.amount)).toEqual([undefined, undefined]);
		if (operation === 'edit')
			await ledgerService.editTransaction(entry.span, draft.replace('draft', 'edited draft'));
		else await ledgerService.deleteTransaction(entry.span);
		expect(state.source).toBe(
			(operation === 'edit' ? draft.replace('draft', 'edited draft') : '') + '\n\n' + prior + '\n'
		);
	}
);

test('source mapping retains whole-journal cost booking and inferred gain', async () => {
	const opens =
		'2000-01-01 open Assets:Stock HOOL\n2000-01-01 open Assets:Cash USD\n2000-01-01 open Income:Gain USD\n\n';
	const buy = '2026-11-01 * "buy"\n  Assets:Stock 1 HOOL {5 USD}\n  Assets:Cash -5 USD';
	const sell =
		'2026-11-06 * "sell"\n  Assets:Stock -1 HOOL {}\n  Assets:Cash 10 USD\n  Income:Gain';
	state.source = opens + sell + '\n\n' + buy + '\n';
	const whole = new ParsedLedger(state.source);
	const isolated = new ParsedLedger(sell);
	try {
		const wholeSell = whole
			.getDirectives()
			.find((d) => d.type === 'transaction' && d.narration === 'sell');
		expect(wholeSell).toMatchObject({
			postings: [{}, {}, { units: { number: '-5', currency: 'USD' } }]
		});
		expect(isolated.getDirectives()[0]).toMatchObject({
			postings: [{}, {}, { units: { number: '-10' } }]
		});
		const entries = await ledgerService.getXactsWithSpans();
		const entry = entries.find((e) => e.xact.note === 'sell')!;
		expect(entry.span.sourceText).toBe(sell);
		expect(entry.xact.postings.map((p) => p.amount)).toEqual([-1, 10, -5]);
		expect(state.writes).not.toHaveBeenCalled();
		await ledgerService.editTransaction(entry.span, sell.replace('sell', 'edited sale'));
		expect(state.source).toBe(opens + sell.replace('sell', 'edited sale') + '\n\n' + buy + '\n');
		expect(
			(await ledgerService.getXactsWithSpans()).find((e) => e.xact.note === 'edited sale')!.xact
				.postings[2].amount
		).toBe(-5);
	} finally {
		whole.free();
		isolated.free();
	}
});

test('mapping preserves scoped tags, multiline headers, marker collisions, and identical entries', async () => {
	const multiline =
		'2026-11-06 ! "Payee" "multi\nline" #cashier-source-0 ^receipt ; header comment\n  Assets:Cash\n  Expenses:Food';
	state.source = 'pushtag #existing\n' + multiline + '\n\n' + multiline + '\npoptag #existing\n';
	const before = state.source;
	const entries = await ledgerService.getXactsWithSpans();
	expect(entries).toHaveLength(2);
	expect(entries.map((e) => e.xact.note)).toEqual(['multi\nline', 'multi\nline']);
	expect(entries.map((e) => e.span.sourceText)).toEqual([multiline, multiline]);
	expect(new Set(entries.map((e) => e.span.startLine)).size).toBe(2);
	expect(state.source).toBe(before);
	expect(state.writes).not.toHaveBeenCalled();
	await ledgerService.editTransaction(entries[1].span, multiline.replace('multi', 'edited'));
	expect(state.source).toBe(
		'pushtag #existing\n' +
			multiline +
			'\n\n' +
			multiline.replace('multi', 'edited') +
			'\npoptag #existing\n'
	);
});

test.each(['edit', 'delete'] as const)(
	'verified unfinished span independently supports %s',
	async (operation) => {
		state.source = '2026-11-06 ! "draft"\n  Assets:Cash\n  Expenses:Food';
		const parsed = new ParsedLedger(state.source);
		let span;
		try {
			[span] = mapDirectiveSpans(state.source, parsed);
		} finally {
			parsed.free();
		}
		if (operation === 'edit')
			await ledgerService.editTransaction(span, state.source.replace('draft', 'edited'));
		else await ledgerService.deleteTransaction(span);
		expect(state.source).toBe(
			operation === 'edit' ? '2026-11-06 ! "edited"\n  Assets:Cash\n  Expenses:Food' : ''
		);
	}
);

test('last transaction without a trailing newline has an inclusive final line', async () => {
	state.source = refund;
	const [{ span }] = await ledgerService.getXactsWithSpans();
	expect(span.sourceText).toBe(refund);
	await ledgerService.editTransaction(span, prior);
	expect(state.source).toBe(prior);
});
