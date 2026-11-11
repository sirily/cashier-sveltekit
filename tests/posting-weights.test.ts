import { describe, expect, test } from 'vitest';
import { Posting, Xact } from '#lib/data/model';
import { DirectiveFormatter } from '#lib/rledger/directiveFormatter';
import {
	effectivePostings,
	exchangeRate,
	inferExchange,
	postingAmountText,
	postingBalance,
	setPostingAmount
} from '#lib/utils/postingWeights';
import { xactToBeancountText } from '#lib/utils/xactUtils';

function posting(account: string, amount: string | number | undefined, currency: string): Posting {
	const result = new Posting();
	result.account = account;
	result.currency = currency;
	setPostingAmount(result, amount);
	return result;
}

function exchange(spent: string | number = '-10', received: string | number = '12.30'): Posting[] {
	return [posting('Assets:GBP', spent, 'GBP'), posting('Assets:USD', received, 'USD')];
}

function transaction(postings: Posting[]): Xact {
	const tx = new Xact();
	tx.date = '2026-11-10';
	tx.payee = 'Exchange';
	tx.note = 'Exact amounts';
	tx.postings = postings;
	return tx;
}

function totals(postings: Posting[]): Record<string, string> {
	return Object.fromEntries(
		Object.entries(postingBalance(postings).totals).map(([currency, value]) => [
			currency,
			value.toFixed()
		])
	);
}

function expectBalanced(postings: Posting[]): void {
	const balance = postingBalance(postings);
	expect(balance.invalid).toBe(false);
	expect(balance.imbalances).toEqual([]);
	expect(balance.isBalanced).toBe(true);
}

function formatPrice(price: { number: string; currency: string; kind?: 'unit' | 'total' }): string {
	const directive = {
		type: 'transaction' as const,
		date: '2026-11-10',
		flag: '*',
		payee: 'Exchange',
		narration: 'Exact amounts',
		tags: [],
		links: [],
		postings: [
			{ account: 'Assets:GBP', units: { number: '-10', currency: 'GBP' }, price },
			{ account: 'Assets:USD', units: { number: '12.30', currency: 'USD' } }
		]
	};
	return DirectiveFormatter.toString(directive);
}

// Tasks 1.1/1.2: exact entered units are authoritative; the rate is presentation only.
describe('two-posting exchange inference', () => {
	test.each([false, true])('attaches @@ to the negative posting (reversed: %s)', (reverse) => {
		const postings = exchange();
		if (reverse) postings.reverse();
		const before = JSON.stringify(postings);
		const negative = reverse ? 1 : 0;
		const positive = 1 - negative;

		expect(inferExchange(postings)).toEqual({
			negative,
			positive,
			spent: '-10',
			received: '12.30'
		});
		const effective = effectivePostings(postings);
		expect(effective).not.toBe(postings);
		expect(effective[negative]).not.toBe(postings[negative]);
		expect(effective[negative].price).toEqual({ kind: 'total', amount: '12.30', currency: 'USD' });
		expect(effective[positive]).toBe(postings[positive]);
		expect(effective[positive].price).toBeUndefined();
		expect(exchangeRate(postings)).toBe('1 GBP = 1.23 USD');
		expect(totals(postings)).toEqual({ USD: '0' });
		expectBalanced(postings);
		expect(xactToBeancountText(transaction(postings))).toBe(
			'2026-11-10 * "Exchange" "Exact amounts"\n' +
				(reverse
					? '    Assets:USD  12.30 USD\n    Assets:GBP  -10 GBP @@ 12.30 USD'
					: '    Assets:GBP  -10 GBP @@ 12.30 USD\n    Assets:USD  12.30 USD')
		);
		expect(JSON.stringify(postings)).toBe(before);
	});

	test('uses the same rule for an asset-to-expense purchase', () => {
		const postings = [
			posting('Expenses:Travel', '12.30', 'USD'),
			posting('Assets:Cash', '-10', 'GBP')
		];
		expect(inferExchange(postings)).toEqual({
			negative: 1,
			positive: 0,
			spent: '-10',
			received: '12.30'
		});
		expect(effectivePostings(postings)[1].price).toEqual({
			kind: 'total',
			amount: '12.30',
			currency: 'USD'
		});
		expectBalanced(postings);
		expect(xactToBeancountText(transaction(postings))).toContain(
			'Assets:Cash  -10 GBP @@ 12.30 USD'
		);
	});

	test('derives the direction from signs rather than a fixed GBP/USD direction', () => {
		const postings = [posting('Assets:GBP', '10', 'GBP'), posting('Assets:USD', '-12.30', 'USD')];
		expect(exchangeRate(postings)).toBe('1 USD = 0.81300813 GBP');
		expect(effectivePostings(postings)[1].price).toEqual({
			kind: 'total',
			amount: '10',
			currency: 'GBP'
		});
		expect(totals(postings)).toEqual({ GBP: '0' });
		expectBalanced(postings);
	});

	test('never reconstructs a total price from a rounded repeating rate', () => {
		const postings = exchange('-3', '10');
		expect(exchangeRate(postings)).toBe('1 GBP = 3.33333333 USD');
		expect(effectivePostings(postings)[0].price?.amount).toBe('10');
		expect(totals(postings)).toEqual({ USD: '0' });
		expectBalanced(postings);
		expect(xactToBeancountText(transaction(postings))).toBe(
			'2026-11-10 * "Exchange" "Exact amounts"\n' +
				'    Assets:GBP  -3 GBP @@ 10 USD\n' +
				'    Assets:USD  10 USD'
		);
	});

	test('preserves high-precision units and @@ decimals beyond the numeric projection', () => {
		const spent = '-9007199254740993.1234567890123456789';
		const received = '12345678901234567.890123456789012345678900';
		const postings = exchange(spent, received);
		expect(String(postings[0].amount)).not.toBe(spent);
		expect(String(postings[1].amount)).not.toBe(received);
		expect(postingAmountText(postings[0])).toBe(spent);
		expect(postingAmountText(postings[1])).toBe(received);
		expect(inferExchange(postings)).toMatchObject({ spent, received });
		expect(effectivePostings(postings)[0].price?.amount).toBe(received);
		expectBalanced(postings);
		expect(totals(postings)).toEqual({ USD: '0' });
		expect(xactToBeancountText(transaction(postings))).toBe(
			`2026-11-10 * "Exchange" "Exact amounts"\n    Assets:GBP  ${spent} GBP @@ ${received} USD\n    Assets:USD  ${received} USD`
		);
	});

	test('recomputes derived prices after either amount or currency changes without persisting them', () => {
		const postings = exchange();
		expect(effectivePostings(postings)[0].price?.amount).toBe('12.30');
		setPostingAmount(postings[0], '-11');
		expect(exchangeRate(postings)).toBe('1 GBP = 1.11818182 USD');
		setPostingAmount(postings[1], '13.20');
		postings[1].currency = 'EUR';
		expect(exchangeRate(postings)).toBe('1 GBP = 1.2 EUR');
		expect(effectivePostings(postings)[0].price).toEqual({
			kind: 'total',
			amount: '13.20',
			currency: 'EUR'
		});
		expect(postings.every((p) => p.price === undefined)).toBe(true);
		expectBalanced(postings);
	});
});

describe('inference exclusions', () => {
	const cases: Array<[string, () => Posting[]]> = [
		['zero spent', () => exchange('0', '12.30')],
		['zero received', () => exchange('-10', '0')],
		['negative zero', () => exchange('-0', '12.30')],
		[
			'missing spent',
			() => [posting('Assets:GBP', undefined, 'GBP'), posting('Assets:USD', '12.30', 'USD')]
		],
		[
			'missing received',
			() => [posting('Assets:GBP', '-10', 'GBP'), posting('Assets:USD', undefined, 'USD')]
		],
		['NaN', () => exchange(NaN, '12.30')],
		['positive infinity', () => exchange('-10', Infinity)],
		['negative infinity', () => exchange(-Infinity, '12.30')],
		['two positive amounts', () => exchange('10', '12.30')],
		['two negative amounts', () => exchange('-10', '-12.30')],
		[
			'same currency',
			() => [posting('Assets:Cash', '-10', 'USD'), posting('Expenses:Food', '10', 'USD')]
		],
		['missing account', () => [posting('', '-10', 'GBP'), posting('Assets:USD', '12.30', 'USD')]],
		[
			'missing currency',
			() => [posting('Assets:GBP', '-10', ''), posting('Assets:USD', '12.30', 'USD')]
		],
		[
			'syntax embedded in currency',
			() => [
				posting('Assets:GBP', '-10', 'GBP @@ 12.30 USD'),
				posting('Assets:USD', '12.30', 'USD')
			]
		],
		['no postings', () => []],
		['one posting', () => [posting('Assets:GBP', '-10', 'GBP')]],
		['commission split', () => [...exchange(), posting('Expenses:Fees', '1', 'USD')]],
		['third omitted posting', () => [...exchange(), posting('Equity:Balancing', undefined, '')]]
	];

	test.each(cases)('does not manufacture a price for %s', (_label, makePostings) => {
		const postings = makePostings();
		const before = postings.map((p) => ({ ...p }));
		expect(inferExchange(postings)).toBeUndefined();
		expect(effectivePostings(postings)).toBe(postings);
		expect(exchangeRate(postings)).toBeUndefined();
		expect(postings).toEqual(before);
		expect(postings.every((p) => p.price === undefined)).toBe(true);
	});

	test.each([0, 1])('excludes a cost/unsupported source annotation on row %s', (index) => {
		const postings = exchange();
		postings[index].sourceAnnotated = true;
		expect(inferExchange(postings)).toBeUndefined();
		expect(effectivePostings(postings)).toBe(postings);
		expect(exchangeRate(postings)).toBeUndefined();
		expect(totals(postings)).toEqual({ GBP: '-10', USD: '12.3' });
		expect(postingBalance(postings).isBalanced).toBe(false);
		expect(postings[index].sourceAnnotated).toBe(true);
	});

	test('retains ordinary same-currency balancing and saves without any price', () => {
		const postings = [
			posting('Assets:Cash', '-12.30', 'USD'),
			posting('Expenses:Food', '12.30', 'USD')
		];
		expectBalanced(postings);
		expect(totals(postings)).toEqual({ USD: '0' });
		expect(xactToBeancountText(transaction(postings))).toBe(
			'2026-11-10 * "Exchange" "Exact amounts"\n    Assets:Cash  -12.30 USD\n    Expenses:Food  12.30 USD'
		);
	});
});

describe('explicit price semantics', () => {
	test.each([0, 1])('leaves an explicit @ on row %s untouched', (index) => {
		const postings = exchange();
		const price = {
			kind: 'unit' as const,
			amount: '1.2300',
			currency: index === 0 ? 'USD' : 'GBP'
		};
		postings[index].price = price;
		expect(inferExchange(postings)).toBeUndefined();
		expect(effectivePostings(postings)).toBe(postings);
		expect(postings[index].price).toBe(price);
		expect(exchangeRate(postings)).toBeUndefined();
		const source = xactToBeancountText(transaction(postings));
		expect(source).toContain(` @ 1.2300 ${price.currency}`);
		expect(source).not.toContain('@@');
		if (index === 0) {
			expect(totals(postings)).toEqual({ USD: '0' });
			expectBalanced(postings);
		}
	});

	test.each(['12.30', '+012.3000', '-012.3000'])(
		'uses signed total weights and preserves explicit spelling %s',
		(amount) => {
			const postings = exchange();
			const price = { kind: 'total' as const, amount, currency: 'USD' };
			postings[0].price = price;
			postings[0].priceBasis = { amount: '12.30', currency: 'USD' };
			expect(inferExchange(postings)).toBeUndefined();
			expect(effectivePostings(postings)).toBe(postings);
			expect(postings[0].price).toBe(price);
			expect(totals(postings)).toEqual({ USD: '0' });
			expectBalanced(postings);
			expect(xactToBeancountText(transaction(postings))).toContain(`-10 GBP @@ ${amount} USD`);
		}
	);

	test('does not silently balance a mismatched explicit @@ against received units', () => {
		const postings = exchange();
		postings[0].price = { kind: 'total', amount: '13.000', currency: 'USD' };
		postings[0].priceBasis = { amount: '12.30', currency: 'USD' };
		setPostingAmount(postings[1], '14.20');
		expect(effectivePostings(postings)).toBe(postings);
		expect(exchangeRate(postings)).toBeUndefined();
		expect(totals(postings)).toEqual({ USD: '1.2' });
		const balance = postingBalance(postings);
		expect(balance.invalid).toBe(false);
		expect(balance.isBalanced).toBe(false);
		expect(balance.imbalances.map(([currency, value]) => [currency, value.toFixed()])).toEqual([
			['USD', '1.2']
		]);
		expect(xactToBeancountText(transaction(postings))).toContain('-10 GBP @@ 13.000 USD');
	});

	test('does not replace an explicit total price denominated in another currency', () => {
		const postings = exchange();
		postings[0].price = { kind: 'total', amount: '12.30', currency: 'EUR' };
		postings[0].priceBasis = { amount: '12.30', currency: 'USD' };
		expect(effectivePostings(postings)).toBe(postings);
		expect(totals(postings)).toEqual({ EUR: '-12.3', USD: '12.3' });
		expect(postingBalance(postings).isBalanced).toBe(false);
		expect(exchangeRate(postings)).toBeUndefined();
		expect(xactToBeancountText(transaction(postings))).toContain('-10 GBP @@ 12.30 EUR');
	});

	test('takes the sign from units, not the total-price text, on either side of a split', () => {
		const negative = posting('Assets:GBP', '-10', 'GBP');
		negative.price = { kind: 'total', amount: '-12.30', currency: 'USD' };
		const positive = posting('Assets:EUR', '5', 'EUR');
		positive.price = { kind: 'total', amount: '-10.30', currency: 'USD' };
		const postings = [negative, positive, posting('Expenses:Fees', '2', 'USD')];
		expect(effectivePostings(postings)).toBe(postings);
		expect(totals([negative])).toEqual({ USD: '-12.3' });
		expect(totals([positive])).toEqual({ USD: '10.3' });
		expectBalanced(postings);
	});

	test('updates a verified matching total-price basis after an explicit received-amount correction', () => {
		const postings = exchange();
		postings[0].price = { kind: 'total', amount: '12.3000', currency: 'USD' };
		postings[0].priceBasis = { amount: '12.30', currency: 'USD' };
		setPostingAmount(postings[1], '13.20');
		const effective = effectivePostings(postings);
		expect(effective[0].price).toEqual({ kind: 'total', amount: '13.20', currency: 'USD' });
		expect(postings[0].price.amount).toBe('12.3000');
		expect(postings[0].priceBasis.amount).toBe('12.30');
		expectBalanced(postings);
		expect(xactToBeancountText(transaction(postings))).toContain('-10 GBP @@ 13.20 USD');
	});

	test.each(['NaN', 'Infinity', '1e3', '-'])(
		'marks invalid explicit price %s invalid without inferring a replacement',
		(amount) => {
			const postings = exchange();
			postings[0].price = { kind: 'total', amount, currency: 'USD' };
			expect(effectivePostings(postings)).toBe(postings);
			expect(exchangeRate(postings)).toBeUndefined();
			expect(postingBalance(postings)).toMatchObject({ invalid: true, isBalanced: false });
		}
	);
});

describe('ordinary balance and omitted units', () => {
	test('allows an omitted balancing posting for a single weight currency and leaves its units omitted', () => {
		const postings = [
			posting('Expenses:Food', '12.30', 'USD'),
			posting('Assets:Cash', undefined, 'USD')
		];
		expect(totals(postings)).toEqual({ USD: '12.3' });
		expectBalanced(postings);
		expect(xactToBeancountText(transaction(postings))).toBe(
			'2026-11-10 * "Exchange" "Exact amounts"\n    Expenses:Food  12.30 USD\n    Assets:Cash'
		);
	});

	test('does not let an omitted amount conceal multiple unbalanced currencies', () => {
		const postings = [...exchange(), posting('Equity:Balancing', undefined, '')];
		const balance = postingBalance(postings);
		expect(balance.invalid).toBe(false);
		expect(balance.isBalanced).toBe(false);
		expect(totals(postings)).toEqual({ GBP: '-10', USD: '12.3' });
		expect(balance.imbalances.map(([currency, value]) => [currency, value.toFixed()])).toEqual([
			['GBP', '-10'],
			['USD', '12.3']
		]);
		expect(xactToBeancountText(transaction(postings))).not.toContain('@@');
	});

	test('uses explicit price weights when deciding whether an omitted amount has one currency', () => {
		const postings = exchange();
		postings[0].price = { kind: 'unit', amount: '1.23', currency: 'USD' };
		postings.push(posting('Expenses:Fees', '1', 'USD'), posting('Assets:Cash', undefined, 'USD'));
		expect(totals(postings)).toEqual({ USD: '1' });
		expectBalanced(postings);
	});

	test('keeps explicit zero distinct from an omitted balancing amount', () => {
		const postings = [
			posting('Expenses:Food', '12.30', 'USD'),
			posting('Assets:Cash', '0.00', 'USD')
		];
		expect(postingBalance(postings)).toMatchObject({ invalid: false, isBalanced: false });
		expect(xactToBeancountText(transaction(postings))).toContain('Assets:Cash  0.00 USD');
	});

	test('sums decimal weights exactly rather than using binary floating-point arithmetic', () => {
		const postings = [
			posting('Assets:Cash', '-0.30', 'USD'),
			posting('Expenses:A', '0.10', 'USD'),
			posting('Expenses:B', '0.20', 'USD')
		];
		expect(totals(postings)).toEqual({ USD: '0' });
		expectBalanced(postings);
	});
});

describe('exact input and numeric compatibility', () => {
	test.each(['+0012.3000', '.123456789012345678901234567890', '-10.000000000000000001'])(
		'retains exact valid input %s',
		(text) => {
			const p = posting('Assets:Cash', text, 'USD');
			expect(p.amount).toBe(Number(text));
			expect(p.amountText).toBe(text);
			expect(postingAmountText(p)).toBe(text);
		}
	);

	test('falls back to the numeric value after a legacy direct amount edit', () => {
		const postings = exchange();
		postings[1].amount = 15.25;
		expect(postings[1].amountText).toBe('12.30');
		expect(postingAmountText(postings[1])).toBe('15.25');
		expect(effectivePostings(postings)[0].price?.amount).toBe('15.25');
		expect(exchangeRate(postings)).toBe('1 GBP = 1.525 USD');
		expectBalanced(postings);
		expect(xactToBeancountText(transaction(postings))).toContain('-10 GBP @@ 15.25 USD');
	});

	test('expands numeric-only small amounts without exponent notation', () => {
		const p = posting('Assets:Cash', 1e-8, 'USD');
		expect(p.amountText).toBeUndefined();
		expect(postingAmountText(p)).toBe('0.00000001');
		expect(xactToBeancountText(transaction([p]))).toContain('0.00000001 USD');
	});

	test.each(['', '-', '+', '.', '-.', '1..2', '1e', '1e3', 'NaN', 'Infinity', ' 12.30 '])(
		'invalid intermediate input %j clears inference and invalidates balance',
		(text) => {
			const postings = exchange();
			expect(effectivePostings(postings)[0].price?.amount).toBe('12.30');
			setPostingAmount(postings[1], text);
			expect(postings[1].amountText).toBe(text);
			expect(postingAmountText(postings[1])).toBeUndefined();
			expect(inferExchange(postings)).toBeUndefined();
			expect(effectivePostings(postings)).toBe(postings);
			expect(exchangeRate(postings)).toBeUndefined();
			expect(postings[0].price).toBeUndefined();
			expect(postingBalance(postings)).toMatchObject({ invalid: true, isBalanced: false });
		}
	);

	test.each(['', '-', '1e3', 'Infinity'])(
		'refuses to serialize invalid entered amount %j as an omitted or stale value',
		(text) => {
			const postings = exchange();
			setPostingAmount(postings[1], text);
			expect(() => xactToBeancountText(transaction(postings))).toThrow(
				/finite decimal posting amount/i
			);
		}
	);

	test.each([NaN, Infinity, -Infinity])(
		'rejects nonfinite numeric amount %s even when old exact text remains',
		(amount) => {
			const postings = exchange();
			postings[1].amount = amount;
			expect(postingAmountText(postings[1])).toBeUndefined();
			expect(inferExchange(postings)).toBeUndefined();
			expect(postingBalance(postings)).toMatchObject({ invalid: true, isBalanced: false });
			expect(() => xactToBeancountText(transaction(postings))).toThrow(
				/finite decimal posting amount/i
			);
		}
	);

	test.each(['12.300000000000000001', '-', '1e3'])(
		'numeric calculator assignment resets old input %j',
		(text) => {
			const postings = exchange('-10', text);
			setPostingAmount(postings[1], 15.25);
			expect(postings[1].amountText).toBeUndefined();
			expect(postings[1].amount).toBe(15.25);
			expect(postingAmountText(postings[1])).toBe('15.25');
			expect(exchangeRate(postings)).toBe('1 GBP = 1.525 USD');
			expectBalanced(postings);
			expect(xactToBeancountText(transaction(postings))).toContain('-10 GBP @@ 15.25 USD');
		}
	);

	test('numeric zero and undefined reset exact text without confusing zero with omission', () => {
		const p = posting('Assets:Cash', '12.3000', 'USD');
		setPostingAmount(p, 0);
		expect(p.amountText).toBeUndefined();
		expect(postingAmountText(p)).toBe('0');
		expect(xactToBeancountText(transaction([p]))).toContain('Assets:Cash  0 USD');
		setPostingAmount(p, undefined);
		expect(p.amount).toBeUndefined();
		expect(p.amountText).toBeUndefined();
		expect(postingAmountText(p)).toBeUndefined();
		expect(xactToBeancountText(transaction([p]))).toBe(
			'2026-11-10 * "Exchange" "Exact amounts"\n    Assets:Cash'
		);
	});

	test('JSON round-trip preserves exact input, total-price kind, basis, flag and annotation guards', () => {
		const postings = exchange('-10.000000000000000001', '12.300000000000000001');
		postings[0].price = { kind: 'total', amount: '+012.3000000000000000010', currency: 'USD' };
		postings[0].priceBasis = { amount: '12.300000000000000001', currency: 'USD' };
		const tx = transaction(postings);
		tx.flag = '!';
		const restored: Xact = JSON.parse(JSON.stringify(tx));
		expect(restored).toEqual(tx);
		expect(restored).not.toBeInstanceOf(Xact);
		expect(restored.postings[0]).not.toBeInstanceOf(Posting);
		expect(postingAmountText(restored.postings[0])).toBe('-10.000000000000000001');
		expect(effectivePostings(restored.postings)).toBe(restored.postings);
		expectBalanced(restored.postings);
		expect(xactToBeancountText(restored)).toBe(xactToBeancountText(tx));
		expect(xactToBeancountText(restored)).toContain(
			'-10.000000000000000001 GBP @@ +012.3000000000000000010 USD'
		);
		restored.postings[1].sourceAnnotated = true;
		const guarded: Xact = JSON.parse(JSON.stringify(restored));
		expect(guarded.postings[1].sourceAnnotated).toBe(true);
		expect(inferExchange(guarded.postings)).toBeUndefined();
		expect(effectivePostings(guarded.postings)).toBe(guarded.postings);
	});

	test('JSON round-trip of unpriced form state still derives exact @@ without storing it', () => {
		const tx = transaction(exchange('-3', '10.000000000000000001'));
		const restored: Xact = JSON.parse(JSON.stringify(tx));
		expect(restored.postings[0].price).toBeUndefined();
		expect(effectivePostings(restored.postings)[0].price?.amount).toBe('10.000000000000000001');
		expectBalanced(restored.postings);
		expect(xactToBeancountText(restored)).toBe(xactToBeancountText(tx));
		expect(restored.postings[0].price).toBeUndefined();
	});
});

describe('DirectiveFormatter price marker compatibility', () => {
	test.each([undefined, 'unit'] as const)('retains legacy @ behavior for kind %s', (kind) => {
		expect(formatPrice({ number: '1.2300', currency: 'USD', ...(kind ? { kind } : {}) })).toBe(
			'2026-11-10 * "Exchange" "Exact amounts"\n    Assets:GBP  -10 GBP @ 1.2300 USD\n    Assets:USD  12.30 USD'
		);
	});

	test.each(['12.30', '+012.3000', '-12.3000'])(
		'emits explicit @@ without normalizing price spelling %s',
		(number) => {
			expect(formatPrice({ number, currency: 'USD', kind: 'total' })).toBe(
				`2026-11-10 * "Exchange" "Exact amounts"\n    Assets:GBP  -10 GBP @@ ${number} USD\n    Assets:USD  12.30 USD`
			);
		}
	);
});
