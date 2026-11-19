import Big from 'big.js';
import type { Posting } from '#lib/data/model';

const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const currency = /^[A-Z][A-Z0-9'._-]*$/;

/** Numeric callers remain compatible, but must not reuse decimal text after changing amount. */
export function postingAmountText(posting: Posting): string | undefined {
	if (posting.amount == null || !Number.isFinite(posting.amount)) return undefined;
	if (posting.amountText !== undefined) {
		if (!decimal.test(posting.amountText)) return undefined;
		if (Number(posting.amountText) === posting.amount) return posting.amountText;
	}
	return new Big(posting.amount).toFixed();
}

export function setPostingAmount(posting: Posting, value: string | number | undefined): void {
	posting.amountText = typeof value === 'string' ? value : undefined;
	posting.amount = value === undefined || value === '' ? undefined : Number(value);
}

function exchangePair(postings: Posting[]) {
	if (postings.length !== 2) return;
	const amounts = postings.map(postingAmountText);
	if (
		postings.some(
			(p, i) =>
				!p.account || p.sourceAnnotated || !currency.test(p.currency) || amounts[i] === undefined
		)
	)
		return;
	const values = amounts.map((a) => new Big(a!.replace(/^\+/, '')));
	if (
		values.some((a) => a.eq(0)) ||
		values[0].s === values[1].s ||
		postings[0].currency === postings[1].currency
	)
		return;
	const negative = values[0].lt(0) ? 0 : 1;
	const positive = 1 - negative;
	return { negative, positive, spent: amounts[negative]!, received: amounts[positive]! };
}

/** Inference is deliberately limited to two otherwise unpriced, explicit postings. */
export function inferExchange(postings: Posting[]) {
	if (postings.some((p) => p.price)) return;
	return exchangePair(postings);
}

/** Derived prices never become persistent form state or a rounded-rate calculation. */
export function effectivePostings(postings: Posting[]): Posting[] {
	const inferred = inferExchange(postings);
	const pair = inferred ?? exchangePair(postings);
	if (!pair) return postings;
	const negative = postings[pair.negative];
	const positive = postings[pair.positive];
	if (!inferred) {
		const price = negative.price;
		const basis = negative.priceBasis;
		if (
			price?.kind !== 'total' ||
			positive.price ||
			!basis ||
			!decimal.test(price.amount) ||
			!decimal.test(basis.amount)
		)
			return postings;
		if (
			!new Big(price.amount.replace(/^\+/, '')).eq(basis.amount.replace(/^\+/, '')) ||
			price.currency !== basis.currency
		)
			return postings;
		if (pair.received === basis.amount && positive.currency === basis.currency) return postings;
	}
	return postings.map((p, index) =>
		index === pair.negative
			? { ...p, price: { kind: 'total', amount: pair.received, currency: positive.currency } }
			: p
	);
}

export function exchangeRate(postings: Posting[]): string | undefined {
	const effective = effectivePostings(postings);
	const pair = exchangePair(effective);
	if (!pair || effective[pair.negative].price?.kind !== 'total' || effective[pair.positive].price)
		return;
	const price = effective[pair.negative].price!;
	if (
		!decimal.test(price.amount) ||
		!new Big(price.amount.replace(/^\+/, '')).eq(pair.received.replace(/^\+/, '')) ||
		price.currency !== effective[pair.positive].currency
	)
		return;
	const rate = new Big(pair.received.replace(/^\+/, ''))
		.div(new Big(pair.spent.replace(/^\+/, '')).abs())
		.toFixed(8)
		.replace(/\.?0+$/, '');
	return `1 ${postings[pair.negative].currency} = ${rate} ${postings[pair.positive].currency}`;
}

/** Both the form indicator and Validate consume these same signed Beancount weights. */
export function postingBalance(postings: Posting[]) {
	const totals: Record<string, Big> = {};
	let invalid = false;
	let hasAutoBalance = false;
	for (const p of effectivePostings(postings)) {
		if (!p.account) continue;
		if (p.amount == null && p.amountText === undefined) {
			hasAutoBalance = true;
			continue;
		}
		const text = postingAmountText(p);
		if (text === undefined) {
			invalid = true;
			continue;
		}
		if (!p.currency) continue;
		let weight = new Big(text.replace(/^\+/, ''));
		let denomination = p.currency;
		if (p.price) {
			if (!decimal.test(p.price.amount) || !currency.test(p.price.currency)) {
				invalid = true;
				continue;
			}
			const price = new Big(p.price.amount.replace(/^\+/, ''));
			weight = p.price.kind === 'total' ? price.abs().times(weight.s) : weight.times(price);
			denomination = p.price.currency;
		}
		totals[denomination] = (totals[denomination] ?? new Big(0)).plus(weight);
	}
	const autoBalanced = hasAutoBalance && Object.keys(totals).length <= 1;
	const imbalances = autoBalanced
		? []
		: Object.entries(totals).filter(([, sum]) => sum.abs().gt('0.005'));
	return { totals, imbalances, invalid, isBalanced: !invalid && imbalances.length === 0 };
}
