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
import { restorePostingSource } from '#lib/rledger/postingSource';
import { postingBalance } from '#lib/utils/postingWeights';

test.each(['*', '!'])(
	'restores exact source units and price kinds, duplicate accounts and flag %s',
	async (flag) => {
		state.files.set(
			'cashier.bean',
			`2025-01-01 ${flag} "Source"\n  Assets:Cash -10.000000000000000001 GBP @@ 12.300000000000000001 USD\n  Assets:Cash 12.300000000000000001 USD\n\n2025-01-02 * "Unit"\n  Assets:Cash -10.00 GBP @ 1.2300 USD\n  Assets:Cash 12.30 USD\n`
		);
		const entries = await ledgerService.getXactsWithSpans();
		expect(entries).toHaveLength(2);
		expect(entries[0].xact.flag).toBe(flag);
		expect(entries[0].xact.postings).toMatchObject([
			{
				account: 'Assets:Cash',
				amount: -10,
				amountText: '-10.000000000000000001',
				currency: 'GBP',
				price: { kind: 'total', amount: '12.300000000000000001', currency: 'USD' }
			},
			{ account: 'Assets:Cash', amount: 12.3, amountText: '12.300000000000000001', currency: 'USD' }
		]);
		expect(entries[0].xact.postings[1].price).toBeUndefined();
		expect(entries[1].xact.postings[0].price).toEqual({
			kind: 'unit',
			amount: '1.2300',
			currency: 'USD'
		});
	}
);

test('posting positions ignore apparent rows in multiline source and retain reversed direction', async () => {
	state.files.set(
		'cashier.bean',
		'2025-01-01 ! "Note\n  Assets:Fake 999 USD"\n  custom: "meta\n  Assets:Fake 888 USD"\n  Assets:Cash 12.30 USD\n  Assets:Cash -10.00 GBP @@ 12.30 USD\n'
	);
	const [{ xact }] = await ledgerService.getXactsWithSpans();
	expect(xact.note).toContain('Assets:Fake');
	expect(xact.postings).toMatchObject([
		{ amountText: '12.30', currency: 'USD' },
		{
			amountText: '-10.00',
			currency: 'GBP',
			price: { kind: 'total', amount: '12.30', currency: 'USD' }
		}
	]);
});

test('unsupported cost/expression rows block inference without attributing their annotations to duplicate accounts', async () => {
	state.files.set(
		'cashier.bean',
		'2025-01-01 * "Cost"\n  Assets:Cash 1 HOOL {2 USD}\n  Assets:Cash -2.00 USD\n\n2025-01-02 ! "Expression"\n  Assets:Cash -(5 + 5) GBP @@ 12.30 USD\n  Assets:Cash 12.30 USD\n'
	);
	const entries = await ledgerService.getXactsWithSpans();
	expect(entries).toHaveLength(2);
	for (const { xact } of entries) {
		expect(xact.postings[0].sourceAnnotated).toBe(true);
		expect(xact.postings[0].price).toBeUndefined();
		expect(xact.postings[0].amountText).toBeUndefined();
		expect(xact.postings[1].price).toBeUndefined();
		expect(xact.postings[1].amountText).toMatch(/^(?:-2.00|12.30)$/);
	}
});

test('unsupported posting flags keep order and prevent automatic inference', async () => {
	state.files.set(
		'cashier.bean',
		'2025-01-01 ! "Flagged"\n  ! Assets:Cash -10.00 GBP @@ 12.30 USD\n  Assets:Cash 12.30 USD\n'
	);
	const [{ xact }] = await ledgerService.getXactsWithSpans();
	expect(xact.flag).toBe('!');
	expect(xact.postings[0].sourceAnnotated).toBe(true);
	expect(xact.postings[0].price).toBeUndefined();
	expect(xact.postings[1].amountText).toBe('12.30');
});

test('ambiguous posting positions fail closed instead of matching by account alone', () => {
	const postings = [{ account: 'Assets:Cash', amount: -10, currency: 'GBP' }];
	restorePostingSource(postings, '  Assets:Cash 12.30 USD', []);
	expect(postings).toEqual([
		{ account: 'Assets:Cash', amount: -10, currency: 'GBP', sourceAnnotated: true }
	]);
});

test.each(['@@ +12.3000 USD', '@ +1.2300 USD', ''])(
	'plus-prefixed units restore exact text without normalizing source annotation %s',
	async (annotation) => {
		const source = `2025-01-01 ! "Plus restore"\n  Assets:GBP -10.00 GBP ${annotation}\n  Assets:USD +12.300000000000000001 USD\n`;
		state.files.set('cashier.bean', source);
		const [{ xact }] = await ledgerService.getXactsWithSpans();
		expect(xact.postings[1].amount).toBe(12.3);
		expect(xact.postings[1].amountText).toBe('+12.300000000000000001');
		expect(xact.postings[0].price).toEqual(
			annotation
				? {
						kind: annotation.startsWith('@@') ? 'total' : 'unit',
						amount: annotation.startsWith('@@') ? '+12.3000' : '+1.2300',
						currency: 'USD'
					}
				: undefined
		);
		expect(xact.postings[0].priceBasis).toEqual(
			annotation.startsWith('@@')
				? {
						amount: '+12.300000000000000001',
						currency: 'USD'
					}
				: undefined
		);
		expect(state.files.get('cashier.bean')).toBe(source);
	}
);

test.each([false, true])(
	'plus-prefixed source decimals restore and survive consecutive corrections (reversed: %s)',
	async (reversed) => {
		const rows = [
			'  Assets:GBP -10.00 GBP @@ +12.3000 USD ; spent',
			'  Assets:USD +12.30 USD ; received'
		];
		if (reversed) rows.reverse();
		const operation = `2025-01-01 ! "Plus" "Original"\n  cashier_id: "plus-id"\n${rows.join('\n')}\n`;
		state.files.set('cashier.bean', prefix + operation + neighbor);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		const negative = xact.postings[reversed ? 1 : 0];
		const positive = xact.postings[reversed ? 0 : 1];
		expect(negative.price).toEqual({ kind: 'total', amount: '+12.3000', currency: 'USD' });
		expect(negative.priceBasis).toEqual({ amount: '+12.30', currency: 'USD' });
		expect(positive.amountText).toBe('+12.30');
		expect(positive.amount).toBe(12.3);
		let saved = await ledgerService.editTransaction(span, xactToBeancountText(xact));
		expect(state.files.get('cashier.bean')).toBe(prefix + operation + neighbor);
		negative.amount = -11;
		saved = await ledgerService.editTransaction(saved, xactToBeancountText(xact));
		expect(state.files.get('cashier.bean')).toBe(
			prefix + operation.replace('-10.00', '-11') + neighbor
		);
		positive.amount = 13.2;
		positive.amountText = '+13.2000';
		positive.currency = 'CAD';
		await ledgerService.editTransaction(saved, xactToBeancountText(xact));
		const expected = operation
			.replace('-10.00', '-11')
			.replace('+12.3000 USD', '+13.2000 CAD')
			.replace('+12.30 USD', '+13.2000 CAD');
		expect(state.files.get('cashier.bean')).toBe(prefix + expected + neighbor);
		const [{ xact: reopened }] = await ledgerService.getXactsWithSpans();
		expect(reopened.postings[reversed ? 1 : 0].priceBasis).toEqual({
			amount: '+13.2000',
			currency: 'CAD'
		});
		expect(persistedIds()).toEqual(['plus-id', 'neighbor-id']);
	}
);

test.each([false, true])(
	'price basis snapshots exact original positive units after all rows restore (reversed: %s)',
	async (reversed) => {
		const rows = [
			'  Assets:Cash -10.000 GBP @@ 12.3000 USD',
			'  Assets:Cash 12.300000000000000001 USD'
		];
		if (reversed) rows.reverse();
		state.files.set('cashier.bean', `2025-01-01 ! "Basis"\n${rows.join('\n')}\n`);
		const [{ xact }] = await ledgerService.getXactsWithSpans();
		const negative = xact.postings[reversed ? 1 : 0];
		const positive = xact.postings[reversed ? 0 : 1];
		expect(negative.priceBasis).toEqual({ amount: '12.300000000000000001', currency: 'USD' });
		expect(negative.price).toEqual({ kind: 'total', amount: '12.3000', currency: 'USD' });
		expect(positive.priceBasis).toBeUndefined();
		positive.amount = 13.2;
		positive.amountText = '13.2000';
		positive.currency = 'CAD';
		expect(negative.priceBasis).toEqual({ amount: '12.300000000000000001', currency: 'USD' });
		expect(JSON.parse(JSON.stringify(xact)).postings[reversed ? 1 : 0].priceBasis).toEqual(
			negative.priceBasis
		);
	}
);

test.each(['99.00 USD', '12.30 CAD'])(
	'price basis records original positive units even when explicit total %s mismatches',
	async (total) => {
		state.files.set(
			'cashier.bean',
			`2025-01-01 ! "Mismatch"\n  Assets:GBP -10 GBP @@ ${total}\n  Assets:USD 12.30 USD\n`
		);
		const [{ xact }] = await ledgerService.getXactsWithSpans();
		expect(xact.postings[0].priceBasis).toEqual({ amount: '12.30', currency: 'USD' });
		expect(xact.postings[1].priceBasis).toBeUndefined();
	}
);

test.each([
	['unpriced', '  Assets:GBP -10 GBP\n  Assets:USD 12.30 USD'],
	['unit price', '  Assets:GBP -10 GBP @ 1.23 USD\n  Assets:USD 12.30 USD'],
	['zero negative', '  Assets:GBP 0 GBP @@ 12.30 USD\n  Assets:USD 12.30 USD'],
	['zero positive', '  Assets:GBP -10 GBP @@ 12.30 USD\n  Assets:USD 0 USD'],
	['same sign', '  Assets:GBP -10 GBP @@ 12.30 USD\n  Assets:USD -12.30 USD'],
	['same currency', '  Assets:GBP -10 USD @@ 12.30 USD\n  Assets:USD 12.30 USD'],
	['positive price', '  Assets:GBP -10 GBP @@ 12.30 USD\n  Assets:USD 12.30 USD @ 1 EUR'],
	['positive total only', '  Assets:GBP -10 GBP\n  Assets:USD 12.30 USD @@ 10 GBP'],
	['omitted units', '  Assets:GBP -10 GBP @@ 12.30 USD\n  Assets:USD'],
	['cost', '  Assets:GBP -10 GBP {1.23 USD} @@ 12.30 USD\n  Assets:USD 12.30 USD'],
	['positive expression', '  Assets:GBP -10 GBP @@ 12.30 USD\n  Assets:USD (12 + 0.30) USD'],
	['posting flag', '  Assets:GBP -10 GBP @@ 12.30 USD\n  ! Assets:USD 12.30 USD'],
	['split', '  Assets:GBP -10 GBP @@ 12.30 USD\n  Assets:USD 10 USD\n  Expenses:Fee 2.30 USD']
])('restoration does not attach price basis to excluded %s source', async (_name, rows) => {
	state.files.set('cashier.bean', `2025-01-01 ! "Excluded basis"\n${rows}\n`);
	const entries = await ledgerService.getXactsWithSpans();
	expect(entries).toHaveLength(1);
	expect(entries[0].xact.postings.length).toBeGreaterThanOrEqual(2);
	for (const posting of entries[0].xact.postings) expect(posting.priceBasis).toBeUndefined();
});

const exchange =
	'2025-01-01 ! "Exchange" "Original" #fx ; header\n  cashier_id: "exchange-id"\n  custom: "keep"\n  Assets:GBP\t-10.00 GBP  @@\t12.30 USD ; spent\n    memo: "keep posting metadata"\n  Assets:USD  12.30 USD ; received\n';

test.each([false, true])(
	'total-price saves preserve source, identity and neighbors across consecutive edits (no-op first: %s)',
	async (noOpFirst) => {
		state.files.set('cashier.bean', prefix + exchange + neighbor);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		const model = JSON.parse(JSON.stringify(xact));
		if (!noOpFirst) model.postings[0].amount = -11;
		const savedSpan = await ledgerService.editTransaction(span, xactToBeancountText(model));
		let expected = noOpFirst ? exchange : exchange.replace('-10.00', '-11');
		expect(state.files.get('cashier.bean')).toBe(prefix + expected + neighbor);
		model.postings[1].amount = 13.2;
		model.note = 'Second correction';
		const secondSpan = await ledgerService.editTransaction(savedSpan, xactToBeancountText(model));
		expected = expected.replaceAll('12.30', '13.2').replace('Original', 'Second correction');
		expect(state.files.get('cashier.bean')).toBe(prefix + expected + neighbor);
		expect(secondSpan.sourceText).toBe(expected.trimEnd());
		expect(secondSpan.endLine - secondSpan.startLine).toBe(
			secondSpan.sourceText.split('\n').length - 1
		);
		const [{ xact: reopened }] = await ledgerService.getXactsWithSpans();
		expect(reopened.postings[0].price).toEqual({ kind: 'total', amount: '13.2', currency: 'USD' });
		expect(reopened.postings[1].amountText).toBe('13.2');
		expect(persistedIds()).toEqual(['exchange-id', 'neighbor-id']);
		await expect(ledgerService.editTransaction(span, xactToBeancountText(model))).rejects.toThrow(
			/source changed/i
		);
	}
);

test('total-price source and destination currency corrections update exact tokens and reopened prices', async () => {
	state.files.set('cashier.bean', prefix + exchange + neighbor);
	const [{ xact, span }] = await ledgerService.getXactsWithSpans();
	xact.postings[0].currency = 'EUR';
	const saved = await ledgerService.editTransaction(span, xactToBeancountText(xact));
	xact.postings[1].currency = 'CAD';
	await ledgerService.editTransaction(saved, xactToBeancountText(xact));
	expect(state.files.get('cashier.bean')).toBe(
		prefix +
			exchange.replace('-10.00 GBP', '-10.00 EUR').replaceAll('12.30 USD', '12.30 CAD') +
			neighbor
	);
	const [{ xact: reopened }] = await ledgerService.getXactsWithSpans();
	expect(reopened.postings[0].price).toEqual({ kind: 'total', amount: '12.30', currency: 'CAD' });
	expect(reopened.postings[0].currency).toBe('EUR');
});

test('cost and structural posting corrections leave the entire journal unchanged', async () => {
	for (const operation of [
		exchange.replace('@@\t12.30 USD', '{1.23 USD} @@ 12.30 USD'),
		exchange
	]) {
		state.files.set('cashier.bean', prefix + operation + neighbor);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		if (operation === exchange) xact.postings.pop();
		else xact.postings[0].amount = -11;
		await expect(ledgerService.editTransaction(span, xactToBeancountText(xact))).rejects.toThrow(
			/no changes were saved/
		);
		expect(state.files.get('cashier.bean')).toBe(prefix + operation + neighbor);
	}
});

test('serializer-backed no-op and narration edits do not normalize explicit @ or inferred @@ source', async () => {
	for (const operation of [
		exchange,
		exchange.replace('@@\t12.30', '@\t1.2300'),
		exchange.replace('  @@\t12.30 USD', '')
	]) {
		state.files.set('cashier.bean', prefix + operation + neighbor);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		const saved = await ledgerService.editTransaction(span, xactToBeancountText(xact));
		expect(state.files.get('cashier.bean')).toBe(prefix + operation + neighbor);
		xact.note = 'Narration only';
		await ledgerService.editTransaction(saved, xactToBeancountText(xact));
		expect(state.files.get('cashier.bean')).toBe(
			prefix + operation.replace('Original', 'Narration only') + neighbor
		);
	}
});

test.each(['@@\t99.00 USD', '@@\t12.30 CAD', '@@\t12.3000 USD'])(
	'no-op and header-only saves preserve explicit source price %s, including repeat saves',
	async (price) => {
		const operation = exchange.replace('@@\t12.30 USD', price);
		state.files.set('cashier.bean', prefix + operation + neighbor);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		const model = JSON.parse(JSON.stringify(xact));
		const first = await ledgerService.editTransaction(span, xactToBeancountText(model));
		expect(state.files.get('cashier.bean')).toBe(prefix + operation + neighbor);
		model.note = 'Header only';
		const second = await ledgerService.editTransaction(first, xactToBeancountText(model));
		expect(state.files.get('cashier.bean')).toBe(
			prefix + operation.replace('Original', 'Header only') + neighbor
		);
		await ledgerService.editTransaction(second, xactToBeancountText(model));
		expect(persistedIds()).toEqual(['exchange-id', 'neighbor-id']);
	}
);

test.each(['@@\t99.00 USD', '@@\t12.30 CAD'])(
	'posting corrections reject mismatched explicit price %s without rewriting or appending',
	async (price) => {
		const operation = exchange.replace('@@\t12.30 USD', price);
		const source = prefix + operation + neighbor;
		state.files.set('cashier.bean', source);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		xact.postings[0].amount = -11;
		await expect(ledgerService.editTransaction(span, xactToBeancountText(xact))).rejects.toThrow(
			/no changes were saved/
		);
		expect(state.files.get('cashier.bean')).toBe(source);
	}
);

test.each(['@@\t99.00 USD', '@@\t12.30 CAD'])(
	'restored mismatched price %s remains imbalanced instead of being implicitly corrected',
	async (price) => {
		state.files.set('cashier.bean', prefix + exchange.replace('@@\t12.30 USD', price) + neighbor);
		const [{ xact }] = await ledgerService.getXactsWithSpans();
		expect(postingBalance(xact.postings).isBalanced).toBe(false);
	}
);

test.each([
	['@@\t99.00 USD', '@@ 99.00 USD'],
	['@@\t12.30 CAD', '@@ 12.30 CAD'],
	['@@\t12.3000 USD', '@@ 12.3000 USD']
])(
	'serializing restored price %s preserves its original total and decimal text',
	async (price, expected) => {
		state.files.set('cashier.bean', prefix + exchange.replace('@@\t12.30 USD', price) + neighbor);
		const [{ xact }] = await ledgerService.getXactsWithSpans();
		expect(xactToBeancountText(xact)).toContain(expected);
	}
);

test('four consecutive saves retain corrections even with the original stale form price object', async () => {
	state.files.set('cashier.bean', prefix + exchange + neighbor);
	const [{ xact, span }] = await ledgerService.getXactsWithSpans();
	const model = JSON.parse(JSON.stringify(xact));
	model.postings[1].amount = 13.2;
	let saved = await ledgerService.editTransaction(span, xactToBeancountText(model));
	expect(model.postings[0].price.amount).toBe('12.30');
	model.postings[0].amount = -11;
	saved = await ledgerService.editTransaction(saved, xactToBeancountText(model));
	model.note = 'Third save';
	saved = await ledgerService.editTransaction(saved, xactToBeancountText(model));
	await ledgerService.editTransaction(saved, xactToBeancountText(model));
	expect(state.files.get('cashier.bean')).toBe(
		prefix +
			exchange
				.replaceAll('12.30', '13.2')
				.replace('-10.00', '-11')
				.replace('Original', 'Third save') +
			neighbor
	);
	expect(persistedIds()).toEqual(['exchange-id', 'neighbor-id']);
});

test('unpriced existing source stays byte-identical for no-op/header saves and gains price only after a posting correction', async () => {
	const operation = exchange.replace('  @@\t12.30 USD', '');
	state.files.set('cashier.bean', prefix + operation + neighbor);
	const [{ xact, span }] = await ledgerService.getXactsWithSpans();
	const first = await ledgerService.editTransaction(span, xactToBeancountText(xact));
	expect(state.files.get('cashier.bean')).toBe(prefix + operation + neighbor);
	xact.note = 'Header only';
	const second = await ledgerService.editTransaction(first, xactToBeancountText(xact));
	expect(state.files.get('cashier.bean')).toBe(
		prefix + operation.replace('Original', 'Header only') + neighbor
	);
	xact.postings[0].amount = -11;
	await ledgerService.editTransaction(second, xactToBeancountText(xact));
	expect(state.files.get('cashier.bean')).toBe(
		prefix +
			operation.replace('-10.00 GBP', '-11 GBP @@ 12.30 USD').replace('Original', 'Header only') +
			neighbor
	);
});

test.each(['explicit', 'omitted negative', 'omitted positive', 'both omitted'])(
	'ordinary %s source becomes an inferred exchange after explicit entry without losing source details',
	async (shape) => {
		const received = shape === 'omitted positive' || shape === 'both omitted' ? '' : '  +12.30 USD';
		const spent = shape === 'omitted negative' || shape === 'both omitted' ? '' : '\t-12.30 USD';
		const operation = `2025-01-01 ! "Cafe" "Ordinary" #keep ^receipt ; header\n  cashier_id: "ordinary-id"\n  custom: "metadata"\n  Expenses:Food${received} ; received\n    memo: "keep"\n  Assets:Cash${spent} ; spent\n`;
		state.files.set('cashier.bean', prefix + operation + neighbor);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		for (let i = 0; i < 2; i++) {
			expect(xact.postings[i].sourceAnnotated).toBeUndefined();
			if (!(i === 0 ? received : spent)) {
				expect(xact.postings[i].amount).toBeUndefined();
				expect(xact.postings[i].amountText).toBeUndefined();
			}
		}
		if (shape !== 'explicit') expect(xactToBeancountText(xact)).not.toContain('@@');
		let saved = await ledgerService.editTransaction(span, xactToBeancountText(xact));
		expect(state.files.get('cashier.bean')).toBe(prefix + operation + neighbor);
		xact.note = 'Header correction';
		saved = await ledgerService.editTransaction(saved, xactToBeancountText(xact));
		const headerOnly = operation.replace('Ordinary', 'Header correction');
		expect(state.files.get('cashier.bean')).toBe(prefix + headerOnly + neighbor);
		xact.postings[0].amount = 12.3;
		xact.postings[0].amountText = '+12.30';
		xact.postings[0].currency = 'USD';
		xact.postings[1].amount = -10;
		xact.postings[1].amountText = '-10';
		xact.postings[1].currency = 'GBP';
		expect(postingBalance(xact.postings).isBalanced).toBe(true);
		expect(xactToBeancountText(xact)).toContain('-10 GBP @@ +12.30 USD');
		saved = await ledgerService.editTransaction(saved, xactToBeancountText(xact));
		const expected = headerOnly
			.replace(`Expenses:Food${received}`, 'Expenses:Food  +12.30 USD')
			.replace(`Assets:Cash${spent}`, `Assets:Cash${spent ? '\t' : '  '}-10 GBP @@ +12.30 USD`);
		expect(state.files.get('cashier.bean')).toBe(prefix + expected + neighbor);
		xact.postings[0].amount = 13.2;
		xact.postings[0].amountText = '+13.2000';
		await ledgerService.editTransaction(saved, xactToBeancountText(xact));
		expect(state.files.get('cashier.bean')).toBe(
			prefix + expected.replaceAll('+12.30 USD', '+13.2000 USD') + neighbor
		);
		expect(persistedIds()).toEqual(['ordinary-id', 'neighbor-id']);
		const [{ xact: reopened }] = await ledgerService.getXactsWithSpans();
		expect(reopened.postings[1].price).toEqual({
			kind: 'total',
			amount: '+13.2000',
			currency: 'USD'
		});
	}
);

test.each(['{1 USD}', '@ 1 USD', '!'])(
	'annotated ordinary %s source cannot become an inferred exchange',
	async (annotation) => {
		const cash =
			annotation === '!' ? '! Assets:Cash -12.30 USD' : `Assets:Cash -12.30 USD ${annotation}`;
		const operation = `2025-01-01 ! "Guard"\n  Expenses:Food 12.30 USD\n  ${cash}\n`;
		const source = prefix + operation + neighbor;
		state.files.set('cashier.bean', source);
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		xact.postings[1].amount = -10;
		xact.postings[1].currency = 'GBP';
		await expect(ledgerService.editTransaction(span, xactToBeancountText(xact))).rejects.toThrow(
			/no changes were saved/
		);
		expect(state.files.get('cashier.bean')).toBe(source);
	}
);

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

test.each([false, true])(
	'returned edit span supports consecutive saves after a no-op first save: %s',
	async (noOpFirstSave) => {
		const [{ xact, span }] = await ledgerService.getXactsWithSpans();
		const model = JSON.parse(JSON.stringify(xact));
		model.note = noOpFirstSave ? 'Original' : 'First correction\nwith another line';
		const savedSpan = await ledgerService.editTransaction(span, xactToBeancountText(model));
		expect(savedSpan.sourceText).toContain(model.note);
		expect(savedSpan.endLine - savedSpan.startLine).toBe(
			savedSpan.sourceText.split('\n').length - 1
		);
		model.note = 'Second correction';
		await ledgerService.editTransaction(savedSpan, xactToBeancountText(model));
		expect(state.files.get('cashier.bean')).toBe(
			prefix + transaction.replace('Original', 'Second correction') + neighbor
		);
		expect(persistedIds()).toEqual(['existing-local-id', 'neighbor-id']);
	}
);

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
