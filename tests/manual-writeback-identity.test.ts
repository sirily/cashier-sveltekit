import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ files: new Map<string, string>(), writes: vi.fn() }));
vi.mock('#lib/utils/opfslib', () => ({
	readFile: async (path: string) => state.files.get(path),
	saveFile: async (path: string, content: string) => {
		state.writes(path, content);
		state.files.set(path, content);
	}
}));

import {
	prepareLocalTransactions,
	reconcileLocalJournalFromPaths
} from '#lib/sync/manual-writeback';

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

			await reconcileLocalJournalFromPaths([], ['book.bean']);

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

			await reconcileLocalJournalFromPaths([], ['book.bean']);

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
				`${header}\n  ${flag}${account}  1 USD\n    cashier_id: "local-id"\n  Assets:Cash  -1 USD\n`
			);

			await reconcileLocalJournalFromPaths([], ['book.bean']);

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

			await reconcileLocalJournalFromPaths([], ['book.bean']);

			expect(state.files.get('cashier.bean')).toBe(local);
			expect(state.writes).not.toHaveBeenCalled();
		}
	);
});
