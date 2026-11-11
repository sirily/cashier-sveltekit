import Big from 'big.js';
import type { Posting } from '#lib/data/model';

export interface SourceToken {
	text: string;
	start: number;
	end: number;
}

export interface SourcePosting {
	account: SourceToken;
	amount?: SourceToken;
	currency?: SourceToken;
	price?: { kind: 'unit' | 'total'; amount: SourceToken; currency: SourceToken };
	supported: boolean;
}

const accountPattern = /^[\p{Lu}\p{Lt}\p{Lo}][^\s:;"{}@]*(?::[^\s:;"{}@]+)+$/u;
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const currencyPattern = /^[A-Z][A-Z0-9'._-]*$/;

/** Token offsets refer to the original text; quoted metadata may span physical lines. */
export function sourcePostingRows(source: string): { rows: SourcePosting[]; supported: boolean } {
	const rows: SourcePosting[] = [];
	let supported = true;
	let line: SourceToken[] = [];
	const finish = () => {
		if (!line.length) return;
		const accountIndex = accountPattern.test(line[0].text) ? 0 : 1;
		const account = line[accountIndex];
		if (account && accountPattern.test(account.text)) {
			const fields = line.slice(accountIndex + 1);
			const plain =
				fields.length === 0 ||
				(fields.length === 2 &&
					decimalPattern.test(fields[0].text) &&
					currencyPattern.test(fields[1].text));
			const priced =
				fields.length === 5 &&
				decimalPattern.test(fields[0].text) &&
				currencyPattern.test(fields[1].text) &&
				/^@@?$/.test(fields[2].text) &&
				decimalPattern.test(fields[3].text) &&
				currencyPattern.test(fields[4].text);
			const safe = accountIndex === 0 && (plain || priced);
			rows.push({
				account,
				amount: plain || priced ? fields[0] : undefined,
				currency: plain || priced ? fields[1] : undefined,
				price: priced
					? {
							kind: fields[2].text === '@@' ? 'total' : 'unit',
							amount: fields[3],
							currency: fields[4]
						}
					: undefined,
				supported: safe
			});
		} else if (
			!/^[a-z][a-zA-Z0-9_-]*:$/.test(line[0].text) &&
			!(line[0].start === 0 && /^\d{4}-\d{2}-\d{2}$/.test(line[0].text))
		) {
			supported = false;
		}
		line = [];
	};
	for (const match of source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|;[^\r\n]*|\r?\n|[^\s";]+/g)) {
		if (/^\r?\n$/.test(match[0])) finish();
		else if (!match[0].startsWith(';'))
			line.push({ text: match[0], start: match.index, end: match.index + match[0].length });
	}
	finish();
	return { rows, supported };
}

/** WASM child line ranges are synthetic: scan actual rows within the verified span. */
export function restorePostingSource(
	postings: Posting[],
	source: string,
	positions: Array<{ name: string }>
): void {
	const parsed = sourcePostingRows(source);
	if (
		!parsed.supported ||
		postings.length !== positions.length ||
		postings.length !== parsed.rows.length ||
		postings.some(
			(p, i) => p.account !== positions[i].name || p.account !== parsed.rows[i].account.text
		)
	) {
		for (const posting of postings) posting.sourceAnnotated = true;
		return;
	}
	for (let index = 0; index < postings.length; index++) {
		const posting = postings[index];
		const row = parsed.rows[index];
		if (!row.supported) {
			posting.sourceAnnotated = true;
			continue;
		}
		if (!row.amount && parsed.rows.every((row) => row.supported && !row.price)) {
			// Ordinary omitted units stay editable, but booked values must not trigger inference.
			posting.amount = undefined;
			posting.amountText = undefined;
			continue;
		}
		if (!row.amount || !row.currency || !Number.isFinite(Number(row.amount.text))) {
			// Rich-source booking is not ordinary explicit input.
			posting.sourceAnnotated = true;
			continue;
		}
		posting.amount = Number(row.amount.text);
		posting.amountText = row.amount.text;
		posting.currency = row.currency.text;
		if (row.price) {
			posting.price = {
				kind: row.price.kind,
				amount: row.price.amount.text,
				currency: row.price.currency.text
			};
		}
	}
	if (
		postings.length !== 2 ||
		postings.some((posting) => posting.sourceAnnotated || !posting.amountText)
	)
		return;
	const amounts = postings.map((posting) => new Big(posting.amountText!.replace(/^\+/, '')));
	if (
		amounts.some((amount) => amount.eq(0)) ||
		amounts[0].s === amounts[1].s ||
		postings[0].currency === postings[1].currency
	)
		return;
	const negative = amounts[0].lt(0) ? 0 : 1;
	const positive = postings[1 - negative];
	if (postings[negative].price?.kind !== 'total' || positive.price) return;
	// Snapshot source units only after both rows are restored; the explicit price may differ.
	postings[negative].priceBasis = { amount: positive.amountText!, currency: positive.currency };
}
