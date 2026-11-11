import { expect, test } from 'vitest';
import { mergeTransactionEdit } from '#lib/rledger/transactionEdit';

const header = '2025-01-01 * "Cafe" "Note"';
const body = '\n    Expenses:Food  1 USD\n    Assets:Cash  -1 USD';

const exchangeSource = `${header} #fx ^receipt ; header comment\n  cashier_id: "exchange-id"\n  custom: "keep"\n  Assets:GBP\t-10.00 GBP  @@\t12.30 USD ; spent\n    memo: "posting metadata\n  Assets:Fake  999 USD"\n  ; between rows\n  Expenses:USD  12.30 USD ; received`;
const exchangeBaseline = `${header}\n    Assets:GBP  -10.00 GBP @@ 12.30 USD\n    Expenses:USD  12.30 USD`;

test.each([false, true])(
	'lossless ordinary rows gain inferred total pricing surgically (omitted: %s)',
	(omitted) => {
		const source = `${header}\n  cashier_id: "id"\n  Expenses:Food  +12.3000 USD ; received\n    memo: "keep"\n  Assets:Cash${omitted ? '' : '\t-12.30 USD'} ; spent`;
		const baseline = `${header}\n    Expenses:Food  +12.3000 USD\n    Assets:Cash${omitted ? '' : '  -12.30 USD'}`;
		const edited = `${header}\n    Expenses:Food  +12.3000 USD\n    Assets:Cash  -10 GBP @@ +12.3000 USD`;
		expect(mergeTransactionEdit(source, baseline, edited)).toBe(
			source.replace(
				`Assets:Cash${omitted ? '' : '\t-12.30 USD'}`,
				`Assets:Cash${omitted ? '  ' : '\t'}-10 GBP @@ +12.3000 USD`
			)
		);
	}
);

test.each(['reorder', 'lossy baseline', 'mismatched total', 'third row', 'cost', 'flag'])(
	'ordinary-to-exchange correction rejects unsafe %s',
	(shape) => {
		let source = `${header}\n  Expenses:Food 12.30 USD ; keep\n  Assets:Cash -12.30 USD`;
		let baseline = `${header}\n    Expenses:Food 12.30 USD\n    Assets:Cash -12.30 USD`;
		let edited = `${header}\n    Expenses:Food 12.30 USD\n    Assets:Cash -10 GBP @@ 12.30 USD`;
		if (shape === 'reorder')
			edited = `${header}\n    Assets:Cash -10 GBP @@ 12.30 USD\n    Expenses:Food 12.30 USD`;
		if (shape === 'lossy baseline')
			source = source.replace('Food 12.30', 'Food 12.300000000000000001');
		if (shape === 'mismatched total') edited = edited.replace('@@ 12.30', '@@ 99');
		if (shape === 'third row') edited += '\n    Expenses:Fee 1 USD';
		if (shape === 'cost') source = source.replace('-12.30 USD', '-12.30 USD {1 EUR}');
		if (shape === 'flag') source = source.replace('Assets:Cash', '! Assets:Cash');
		expect(() => mergeTransactionEdit(source, baseline, edited)).toThrow(/no changes were saved/);
	}
);

test.each([
	['+12.3000', '+12.30'],
	['12.3000', '+12.30'],
	['+12.3000', '12.30']
])(
	'plus-prefixed total %s and received units %s retain spelling across corrections',
	(price, amount) => {
		const source = exchangeSource
			.replace('@@\t12.30 USD', `@@\t${price} USD`)
			.replace('Expenses:USD  12.30 USD', `Expenses:USD  ${amount} USD`);
		const baseline = exchangeBaseline
			.replace('@@ 12.30 USD', `@@ ${price} USD`)
			.replace('Expenses:USD  12.30 USD', `Expenses:USD  ${amount} USD`);
		expect(mergeTransactionEdit(source, baseline, baseline)).toBe(source);
		expect(mergeTransactionEdit(source, baseline, baseline.replace('Note', 'Edited'))).toBe(
			source.replace('Note', 'Edited')
		);
		const firstEdit = baseline.replace('-10.00', '-11');
		const firstSave = mergeTransactionEdit(source, baseline, firstEdit);
		expect(firstSave).toBe(source.replace('-10.00', '-11'));
		const secondEdit = firstEdit.replace(
			`Expenses:USD  ${amount} USD`,
			'Expenses:USD  +13.2000 CAD'
		);
		expect(mergeTransactionEdit(firstSave, firstEdit, secondEdit)).toBe(
			source
				.replace('-10.00', '-11')
				.replace(`@@\t${price} USD`, '@@\t+13.2000 CAD')
				.replace(`Expenses:USD  ${amount} USD`, 'Expenses:USD  +13.2000 CAD')
		);
	}
);

test('plus-prefixed ordinary units remain unchanged during an account correction', () => {
	const source = `${header}\n  Expenses:Food  +1.00 USD\n  Assets:Cash -1.00 USD`;
	const baseline = `${header}\n    Expenses:Food  +1.00 USD\n    Assets:Cash -1.00 USD`;
	expect(
		mergeTransactionEdit(source, baseline, baseline.replace('Expenses:Food', 'Expenses:Other'))
	).toBe(source.replace('Expenses:Food', 'Expenses:Other'));
});

test('plus-prefixed mismatched totals still reject posting corrections', () => {
	const source = exchangeSource
		.replace('@@\t12.30 USD', '@@\t+99.00 USD')
		.replace('Expenses:USD  12.30 USD', 'Expenses:USD  +12.30 USD');
	const baseline = exchangeBaseline
		.replace('@@ 12.30 USD', '@@ +99.00 USD')
		.replace('Expenses:USD  12.30 USD', 'Expenses:USD  +12.30 USD');
	expect(() => mergeTransactionEdit(source, baseline, baseline.replace('-10.00', '-11'))).toThrow(
		/no changes were saved/
	);
});

test.each([
	['-10.00 GBP', '-11.000 GBP'],
	['-10.00 GBP', '-10.00 EUR'],
	['Assets:GBP', 'Assets:Wallet'],
	['Expenses:USD', 'Assets:Received']
])('total-price correction of %s preserves every other source token', (from, to) => {
	expect(
		mergeTransactionEdit(exchangeSource, exchangeBaseline, exchangeBaseline.replace(from, to))
	).toBe(exchangeSource.replace(from, to));
});

test.each([
	['12.30 USD', '13.20 USD'],
	['12.30 USD', '12.30 CAD']
])('positive posting owns correction of %s including a stale explicit total', (from, to) => {
	const edited = exchangeBaseline.replace(`Expenses:USD  ${from}`, `Expenses:USD  ${to}`);
	expect(mergeTransactionEdit(exchangeSource, exchangeBaseline, edited)).toBe(
		exchangeSource.replaceAll(from, to)
	);
});

test('total-price no-op and header edit preserve comments and decimal spelling', () => {
	expect(mergeTransactionEdit(exchangeSource, exchangeBaseline, exchangeBaseline)).toBe(
		exchangeSource
	);
	expect(
		mergeTransactionEdit(
			exchangeSource,
			exchangeBaseline,
			exchangeBaseline.replace('Note', 'Edited')
		)
	).toBe(exchangeSource.replace('Note', 'Edited'));
	const differentlySpelled = exchangeSource.replace('@@\t12.30', '@@\t12.3000');
	expect(
		mergeTransactionEdit(
			differentlySpelled,
			exchangeBaseline,
			exchangeBaseline.replace('-10.00', '-11')
		)
	).toBe(differentlySpelled.replace('-10.00', '-11'));
});

test('consecutive total-price corrections retain exact source after the first save', () => {
	const firstEdit = exchangeBaseline.replace('-10.00', '-11');
	const firstSave = mergeTransactionEdit(exchangeSource, exchangeBaseline, firstEdit);
	const secondEdit = firstEdit.replace('Expenses:USD  12.30 USD', 'Expenses:USD  13.2000 CAD');
	const secondSave = mergeTransactionEdit(firstSave, firstEdit, secondEdit);
	expect(secondSave).toBe(
		exchangeSource.replace('-10.00', '-11').replaceAll('12.30 USD', '13.2000 CAD')
	);
});

test('total-price correction preserves high-precision original units and changed destination decimals', () => {
	const baseline = exchangeBaseline
		.replace('-10.00', '-10.000000000000000001')
		.replaceAll('12.30', '12.300000000000000001');
	const source = exchangeSource
		.replace('-10.00', '-10.000000000000000001')
		.replaceAll('12.30', '12.300000000000000001');
	const edited = baseline.replace(
		'Expenses:USD  12.300000000000000001',
		'Expenses:USD  13.200000000000000009'
	);
	expect(mergeTransactionEdit(source, baseline, edited)).toBe(
		source.replaceAll('12.300000000000000001', '13.200000000000000009')
	);
});

test('unbalanced source total cannot be silently corrected as a supported exchange', () => {
	const source = exchangeSource.replace('@@\t12.30', '@@\t99');
	expect(() =>
		mergeTransactionEdit(source, exchangeBaseline, exchangeBaseline.replace('-10.00', '-11'))
	).toThrow(/no changes were saved/);
});

test('reversed total-price rows still use the positive posting', () => {
	const source = `${header}\n  Expenses:USD  12.30 USD ; received\n  Assets:GBP -10.00 GBP @@ 12.30 USD ; spent`;
	const baseline = `${header}\n    Expenses:USD  12.30 USD\n    Assets:GBP -10.00 GBP @@ 12.30 USD`;
	expect(
		mergeTransactionEdit(
			source,
			baseline,
			baseline.replace('Expenses:USD  12.30', 'Expenses:USD  13.20')
		)
	).toBe(source.replaceAll('12.30', '13.20'));
});

test('inferred serializer price does not normalize an unpriced no-op or header save', () => {
	const source = `${header}\n  Assets:GBP -10.00 GBP ; spent\n  Expenses:USD 12.30 USD`;
	expect(mergeTransactionEdit(source, exchangeBaseline, exchangeBaseline)).toBe(source);
	expect(
		mergeTransactionEdit(source, exchangeBaseline, exchangeBaseline.replace('Note', 'Edited'))
	).toBe(source.replace('Note', 'Edited'));
	const unpricedBaseline = exchangeBaseline.replace(' @@ 12.30 USD', '');
	expect(mergeTransactionEdit(source, unpricedBaseline, exchangeBaseline)).toBe(source);
	expect(
		mergeTransactionEdit(source, exchangeBaseline, exchangeBaseline.replace('-10.00', '-11'))
	).toBe(source.replace('-10.00 GBP', '-11 GBP @@ 12.30 USD'));
});

test.each([
	exchangeBaseline + '\n    Expenses:Fee  1 USD',
	exchangeBaseline.split('\n').slice(0, 2).join('\n'),
	exchangeBaseline.replace('-10.00', '10.00'),
	exchangeBaseline.replace('-10.00 GBP', '-10.00 USD'),
	exchangeBaseline.replace('@@', '@'),
	`${header}\n    Expenses:USD  12.30 USD\n    Assets:GBP  -10.00 GBP @@ 12.30 USD`
])('total-price structural/directional edit fails closed: %s', (edited) => {
	expect(() => mergeTransactionEdit(exchangeSource, exchangeBaseline, edited)).toThrow(
		/no changes were saved/
	);
});

test.each(['@ 1.23 USD', '{1.23 USD} @@ 12.30 USD', '@@ (12 + 0.30) USD'])(
	'unsupported price/cost syntax never becomes a total-price correction: %s',
	(annotation) => {
		const source = exchangeSource.replace('@@\t12.30 USD', annotation);
		expect(() =>
			mergeTransactionEdit(source, exchangeBaseline, exchangeBaseline.replace('-10.00', '-11'))
		).toThrow(/no changes were saved/);
	}
);

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
