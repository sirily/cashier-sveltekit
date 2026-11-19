import { readFileSync } from 'node:fs';
import init, { ParsedLedger } from '@rustledger/wasm';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ files: new Map<string, string>(), writes: vi.fn() }));
vi.mock('#lib/sync/journal-storage', () => ({
	readJournal: async () => state.files.get('cashier.bean'),
	saveJournal: async (_expected: string, content: string) => {
		state.writes('cashier.bean', content);
		state.files.set('cashier.bean', content);
	}
}));

import {
	prepareLocalTransactions,
	reconcileLocalJournalFromPaths
} from '#lib/sync/manual-writeback';

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});

function parsedServerIds(): string[] {
	const parsed = new ParsedLedger(state.files.get('book.bean') ?? '');
	try {
		expect(parsed.getParseErrors()).toEqual([]);
		const result = parsed.query("SELECT DISTINCT entry_meta('cashier_id') WHERE flag = '*'");
		expect(result.errors).toEqual([]);
		return result.rows.flatMap((row) => (typeof row[0] === 'string' && row[0] ? [row[0]] : []));
	} finally {
		parsed.free();
	}
}

const generatedId = '00000000-0000-4000-8000-000000000001';
const header = '2025-01-01 * "Cafe" "Identity ownership"';
const accounts = [
	'Expenses:Food',
	'Expenses:Еда',
	'Expenses:食物',
	'Expenses:Épicerie',
	'資産:現金',
	'ǅRoot:Cash'
];
const postingFlags = [
	'',
	'* ',
	'! ',
	'P ',
	'S ',
	'T ',
	'C ',
	'U ',
	'R ',
	'M ',
	'? ',
	'& ',
	'# ',
	'% '
];
const postingCases = postingFlags.flatMap((flag) => accounts.map((account) => [flag, account]));

beforeEach(() => {
	state.files.clear();
	state.writes.mockClear();
	vi.spyOn(crypto, 'randomUUID').mockReturnValue(generatedId);
});

describe('writeback transaction metadata ownership', () => {
	for (const flag of postingFlags) {
		test.each(accounts)(
			`does not promote metadata on ${flag}%s during preparation`,
			async (account) => {
				const postings = `  ${flag}${account}  1 USD ; keep posting comment
    cashier_id: "posting-only-id"
    category: "keep posting metadata"
  Assets:Cash  -1 USD
`;
				const source = `${header}\n${postings}`;
				state.files.set('cashier.bean', source);

				const expected = `${header}\n    cashier_id: "${generatedId}"\n${postings}`;
				expect(await prepareLocalTransactions()).toEqual([
					{ cashierId: generatedId, rawText: expected.trimEnd() }
				]);
				expect(state.files.get('cashier.bean')).toBe(expected);
				expect(await prepareLocalTransactions()).toEqual([
					{ cashierId: generatedId, rawText: expected.trimEnd() }
				]);
				expect(state.writes).toHaveBeenCalledTimes(1);
			}
		);
	}

	const compactCommentPostings = [
		'Assets:Cash',
		'P Assets:Cash',
		'? Assets:Cash',
		'資産:現金',
		'P 資産:現金',
		'? 資産:現金'
	];

	test.each(compactCommentPostings)(
		'preparation preserves %s;comment posting ownership',
		async (posting) => {
			const postings = `  ${posting};keep compact comment\n    cashier_id: "posting-id"\n  Expenses:Food  1 USD\n`;
			state.files.set('cashier.bean', `${header}\n${postings}`);
			const expected = `${header}\n    cashier_id: "${generatedId}"\n${postings}`;

			expect(await prepareLocalTransactions()).toEqual([
				{ cashierId: generatedId, rawText: expected.trimEnd() }
			]);
			expect(state.files.get('cashier.bean')).toBe(expected);
		}
	);

	test.each(compactCommentPostings)(
		'pulled %s;comment posting metadata cannot confirm a local entry',
		async (posting) => {
			const local = `${header}\n  cashier_id: "local-id"\n  Expenses:Food  1 USD\n  Assets:Cash  -1 USD\n`;
			state.files.set('cashier.bean', local);
			state.files.set(
				'book.bean',
				`${header}\n  ${posting};keep compact comment\n    cashier_id: "local-id"\n  Expenses:Food  1 USD\n`
			);

			await reconcileLocalJournalFromPaths([], ['book.bean'], {
				accepted: ['local-id', 'server-id'].map((cashierId) => ({
					cashierId,
					rawText: local.trimEnd()
				})),
				confirmedIds: parsedServerIds()
			});

			expect(state.files.get('cashier.bean')).toBe(local);
			expect(state.writes).not.toHaveBeenCalled();
		}
	);

	test.each(compactCommentPostings)(
		'local %s;comment posting identity cannot authorize removal',
		async (posting) => {
			const local = `${header}\n  ${posting};keep compact comment\n    cashier_id: "server-id"\n  Expenses:Food  1 USD\n`;
			state.files.set('cashier.bean', local);
			state.files.set(
				'book.bean',
				`${header}\n  cashier_id: "server-id"\n  Expenses:Food  1 USD\n  Assets:Cash  -1 USD\n`
			);

			await reconcileLocalJournalFromPaths([], ['book.bean'], {
				accepted: ['local-id', 'server-id'].map((cashierId) => ({
					cashierId,
					rawText: local.trimEnd()
				})),
				confirmedIds: parsedServerIds()
			});

			expect(state.files.get('cashier.bean')).toBe(local);
			expect(state.writes).not.toHaveBeenCalled();
		}
	);

	test.each([
		'  ;cashier_id: "comment-only-id"',
		'  active:TRUE ; cashier_id: "inline-comment-id"',
		'  account:Assets:Cash',
		'  receipt: "first line\n  cashier_id: \\"quoted-only-id\\"\nlast line"'
	])('retains transaction identity after annotation %s', async (annotation) => {
		const source = `${header} ; "unclosed quote in comment
${annotation}
\tcashier_id:"transaction-id" ; keep identity comment
  Expenses:Food  1 USD
    cashier_id: "posting-only-id"
  Assets:Cash  -1 USD
`;
		state.files.set('cashier.bean', source);

		expect(await prepareLocalTransactions()).toEqual([
			{ cashierId: 'transaction-id', rawText: source.trimEnd() }
		]);
		expect(state.files.get('cashier.bean')).toBe(source);
		expect(state.writes).not.toHaveBeenCalled();
	});

	test('ignores apparent identity and posting boundaries inside multiline narration', async () => {
		const source = `2025-01-01 * "Cafe" "first line
  Expenses:Food ; not a posting
  cashier_id: " ; "not-metadata"
  cashier_id:"transaction-id" ; actual transaction metadata
  Expenses:Food  1 USD
    cashier_id: "posting-only-id"
  Assets:Cash  -1 USD
`;
		state.files.set('cashier.bean', source);

		expect(await prepareLocalTransactions()).toEqual([
			{ cashierId: 'transaction-id', rawText: source.trimEnd() }
		]);
		expect(state.files.get('cashier.bean')).toBe(source);
		expect(state.writes).not.toHaveBeenCalled();
	});

	test.each(postingCases)(
		'posting metadata on pulled %s%s cannot confirm a local entry',
		async (flag, account) => {
			const local = `${header}\n  cashier_id: "local-id"\n  Expenses:Food  1 USD\n  Assets:Cash  -1 USD\n`;
			state.files.set('cashier.bean', local);
			state.files.set(
				'book.bean',
				// WASM treats % as a comment, so anchor its following metadata to a real posting.
				`${header}\n  ${flag}${account}  1 USD\n${flag === '% ' ? '  Expenses:Other  0 USD\n' : ''}    cashier_id: "local-id"\n  Assets:Cash  -1 USD\n`
			);

			await reconcileLocalJournalFromPaths([], ['book.bean'], {
				accepted: ['local-id', 'server-id'].map((cashierId) => ({
					cashierId,
					rawText: local.trimEnd()
				})),
				confirmedIds: parsedServerIds()
			});

			expect(state.files.get('cashier.bean')).toBe(local);
			expect(state.writes).not.toHaveBeenCalled();
		}
	);

	test.each(postingCases)(
		'local %s%s posting identity cannot authorize removal',
		async (flag, account) => {
			const local = `${header}\n  ${flag}${account}  1 USD\n    cashier_id: "server-id"\n  Assets:Cash  -1 USD\n`;
			state.files.set('cashier.bean', local);
			state.files.set(
				'book.bean',
				`${header}\n  cashier_id: "server-id"\n  Expenses:Food  1 USD\n  Assets:Cash  -1 USD\n`
			);

			await reconcileLocalJournalFromPaths([], ['book.bean'], {
				accepted: ['local-id', 'server-id'].map((cashierId) => ({
					cashierId,
					rawText: local.trimEnd()
				})),
				confirmedIds: parsedServerIds()
			});

			expect(state.files.get('cashier.bean')).toBe(local);
			expect(state.writes).not.toHaveBeenCalled();
		}
	);
});

test('preparation cannot invent transactions or insert metadata inside multiline narration', async () => {
	const header =
		'2026-06-01 * "Cafe" "First line\n2026-06-02 * fake transaction inside narration\n  2026-06-03 ! indented fake draft\nLast line"';
	const source = header + '\n  Expenses:Food  3 ITEM @@ 10.01 USD\n  Assets:Cash  -10.01 USD\n';
	state.files.set('cashier.bean', source);
	const expected = header + `\n    cashier_id: "${generatedId}"` + source.slice(header.length);
	expect(await prepareLocalTransactions()).toEqual([
		{ cashierId: generatedId, rawText: expected.trimEnd() }
	]);
	expect(state.files.get('cashier.bean')).toBe(expected);
	expect(await prepareLocalTransactions()).toEqual([
		{ cashierId: generatedId, rawText: expected.trimEnd() }
	]);
	expect(state.writes).toHaveBeenCalledOnce();
});

test('metadata of the following directive cannot become a transaction identity', async () => {
	const source = header + '\n  Expenses:Food  1 USD\n  Assets:Cash  -1 USD\n';
	const tail = '\n2026-06-02 balance Assets:Cash  99 USD\n  cashier_id: "balance-id"\n';
	state.files.set('cashier.bean', source + tail);
	const expected = `${header}\n    cashier_id: "${generatedId}"` + source.slice(header.length);
	expect(await prepareLocalTransactions()).toEqual([
		{ cashierId: generatedId, rawText: expected.trimEnd() }
	]);
	expect(state.files.get('cashier.bean')).toBe(expected + tail);
});

test.each(postingCases)(
	'parsed confirmation cannot promote local %s%s posting metadata',
	async (flag, account) => {
		const rawText = `${header}\n  ${flag}${account}  1 USD\n    cashier_id: "posting-id"\n  Assets:Cash  -1 USD`;
		state.files.set('cashier.bean', rawText + '\n');
		await reconcileLocalJournalFromPaths([], [], {
			accepted: [{ cashierId: 'posting-id', rawText }],
			confirmedIds: ['posting-id']
		});
		expect(state.files.get('cashier.bean')).toBe(rawText + '\n');
		expect(state.writes).not.toHaveBeenCalled();
	}
);

describe.each([' ', '  ', '\t'])('indented source boundaries (%j)', (indent) => {
	const completed = `${header}\n  cashier_id: "completed-id"\n  Expenses:Food  1 USD\n  Assets:Cash  -1 USD`;
	const draft = `${indent}2025-01-02 ! "Draft" "Keep authored source"\n    cashier_id: "draft-id"\n    Expenses:Food  2 USD\n    Assets:Cash  -2 USD`;
	const balance = `${indent}2025-01-03 balance Assets:Cash  99 USD\n    cashier_id: "balance-id"`;

	function expectParsed(source: string, types: string[]) {
		const parsed = new ParsedLedger(source);
		try {
			expect(parsed.getParseErrors()).toEqual([]);
			expect(parsed.getDirectives().map((directive) => directive.type)).toEqual(types);
		} finally {
			parsed.free();
		}
	}

	test.each([
		['draft', draft, 'transaction'],
		['balance', balance, 'balance']
	])('never sends or deletes an indented %s after a completed entry', async (_name, tail, type) => {
		const source = completed + '\n' + tail + '\n';
		expectParsed(source, ['transaction', type]);
		state.files.set('cashier.bean', source);
		const accepted = await prepareLocalTransactions();
		expect(accepted).toEqual([{ cashierId: 'completed-id', rawText: completed }]);
		expect(state.files.get('cashier.bean')).toBe(source);
		state.files.set('book.bean', completed + '\n');
		await reconcileLocalJournalFromPaths([], ['book.bean'], {
			accepted,
			confirmedIds: parsedServerIds()
		});
		expect(state.files.get('cashier.bean')).toBe('\n' + tail + '\n');
	});

	test('mixed draft and balance remain exact when preparation assigns a missing ID', async () => {
		const missing = completed.replace('  cashier_id: "completed-id"\n', '');
		const source = missing + '\n' + draft + '\n' + balance + '\n';
		expectParsed(source, ['transaction', 'transaction', 'balance']);
		state.files.set('cashier.bean', source);
		const accepted = await prepareLocalTransactions();
		const identified = missing.replace('\n', `\n    cashier_id: "${generatedId}"\n`);
		expect(accepted).toEqual([{ cashierId: generatedId, rawText: identified }]);
		expect(state.files.get('cashier.bean')).toBe(identified + '\n' + draft + '\n' + balance + '\n');
		state.files.set('book.bean', identified + '\n');
		await reconcileLocalJournalFromPaths([], ['book.bean'], {
			accepted,
			confirmedIds: parsedServerIds()
		});
		expect(state.files.get('cashier.bean')).toBe('\n' + draft + '\n' + balance + '\n');
	});

	test('prepares a standalone indented completed entry without losing source indentation', async () => {
		const rawText = indent + completed;
		state.files.set('cashier.bean', rawText + '\n');
		expect(await prepareLocalTransactions()).toEqual([{ cashierId: 'completed-id', rawText }]);
		expect(state.files.get('cashier.bean')).toBe(rawText + '\n');
		// 0.14.1 accepts this indentation after a transaction, but not at document start.
		const standalone = new ParsedLedger(rawText + '\n');
		try {
			expect(standalone.getParseErrors().length).toBeGreaterThan(0);
		} finally {
			standalone.free();
		}
	});

	test('prepares and reconciles a WASM-accepted indented completed entry after a draft', async () => {
		const prefix = draft.trimStart();
		const rawText = indent + completed;
		const source = prefix + '\n' + rawText + '\n';
		expectParsed(source, ['transaction', 'transaction']);
		state.files.set('cashier.bean', source);
		const accepted = await prepareLocalTransactions();
		expect(accepted).toEqual([{ cashierId: 'completed-id', rawText }]);
		state.files.set('book.bean', completed + '\n');
		await reconcileLocalJournalFromPaths([], ['book.bean'], {
			accepted,
			confirmedIds: parsedServerIds()
		});
		expect(state.files.get('cashier.bean')).toBe(prefix + '\n\n');
	});
});
