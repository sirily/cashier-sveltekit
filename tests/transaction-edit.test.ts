import { expect, test } from 'vitest';
import { mergeTransactionEdit } from '#lib/rledger/transactionEdit';

const header = '2025-01-01 * "Cafe" "Note"';
const body = '\n    Expenses:Food  1 USD\n    Assets:Cash  -1 USD';

test.each(['{2 USD}', '@ 2 USD', '@@ 2 USD', '{}', '; comment'])(
	'header edits preserve posting annotation %s',
	(annotation) => {
		const source = `${header} #tag ^link ; header comment\n  custom: "keep"\n  Assets:Stock  1 HOOL ${annotation}\n  Assets:Cash -2 USD`;
		expect(mergeTransactionEdit(source, header + body, header + body)).toBe(source);
		expect(
			mergeTransactionEdit(source, header + body, header.replace('Note', 'Edited') + body)
		).toBe(source.replace('Note', 'Edited'));
		expect(() =>
			mergeTransactionEdit(source, header + body, header + body.replace('1 USD', '3 USD'))
		).toThrow(/no changes were saved/);
	}
);

test('changing an account retains exact unedited precision and omitted balancing amount', () => {
	const source = `${header}\n  custom: "keep"\n  Expenses:Food  0.123456789012345678 USD\n  Expenses:Other  1 USD\n  Assets:Cash`;
	const baseline = `${header}\n    Expenses:Food  0.12345678901234568 USD\n    Expenses:Other  1 USD\n    Assets:Cash  -1.1234567890123457 USD`;
	expect(
		mergeTransactionEdit(source, baseline, baseline.replace('Expenses:Other', 'Expenses:Different'))
	).toBe(source.replace('Expenses:Other', 'Expenses:Different'));
	expect(
		mergeTransactionEdit(source, baseline, baseline.replace('Expenses:Food', 'Expenses:Different'))
	).toBe(source.replace('Expenses:Food', 'Expenses:Different'));
});

test('changing currency alone preserves the unedited exact amount', () => {
	const source = `${header}\n  Expenses:Food  0.123456789012345678 USD\n  Assets:Cash -1 USD`;
	const baseline = `${header}\n    Expenses:Food  0.12345678901234568 USD\n    Assets:Cash  -1 USD`;
	expect(mergeTransactionEdit(source, baseline, baseline.replace('568 USD', '568 EUR'))).toBe(
		source.replace('678 USD', '678 EUR')
	);
});

test('structural edits reject a lossy numeric projection', () => {
	const source = `${header}\n  Expenses:Food  0.123456789012345678 USD\n  Assets:Cash`;
	const baseline = `${header}\n    Expenses:Food  0.12345678901234568 USD\n    Assets:Cash  -0.12345678901234568 USD`;
	expect(() =>
		mergeTransactionEdit(source, baseline, baseline + '\n    Expenses:Other  0 USD')
	).toThrow(/no changes were saved/);
});

test('same-count reorder rejects rounded rows rather than changing account/amount associations', () => {
	const source = `${header}\n  Expenses:A  0.123456789012345678 USD\n  Expenses:B  0.123456789012345679 USD`;
	const baseline = `${header}\n    Expenses:A  0.12345678901234568 USD\n    Expenses:B  0.12345678901234568 USD`;
	const edited = `${header}\n    Expenses:B  0.12345678901234568 USD\n    Expenses:A  0.12345678901234568 USD`;
	expect(() => mergeTransactionEdit(source, baseline, edited)).toThrow(/no changes were saved/);
});

test('plain structural edits retain transaction metadata without duplicating identity', () => {
	const source = `${header}\n  cashier_id: "id"\n  custom: "keep"${body}`;
	const edited = `${header}\n    Expenses:Food  1 USD`;
	expect(mergeTransactionEdit(source, header + body, edited)).toBe(
		`${header}\n  cashier_id: "id"\n  custom: "keep"\n    Expenses:Food  1 USD`
	);
});

test.each(['P Expenses:Food', '? Expenses:Food', '資産:現金', 'ǅRoot:Cash'])(
	'posting changes fail closed for source row %s',
	(account) => {
		const source = `${header}\n  ${account} 1 USD\n    custom: "posting"\n  Assets:Cash -1 USD`;
		expect(() =>
			mergeTransactionEdit(source, header + body, header + body.replace('1 USD', '2 USD'))
		).toThrow(/no changes were saved/);
	}
);

test('explicit empty payee can be set equal to narration', () => {
	const source = '2025-01-01 * "" "Note" #keep' + body;
	const baseline = '2025-01-01 * "Note"' + body;
	const edited = '2025-01-01 * "Note" "Note"' + body;
	expect(mergeTransactionEdit(source, baseline, edited)).toBe(source.replace('""', '"Note"'));
});

test('multiline source strings and header comment survive unrelated header edits', () => {
	const source = `${header.replace('Note', 'multi\nline')} #tag ; comment${body}`;
	const baseline = header.replace('Note', 'multi\\nline') + body;
	expect(mergeTransactionEdit(source, baseline, baseline.replace('Cafe', 'Other'))).toBe(
		source.replace('Cafe', 'Other')
	);
});
