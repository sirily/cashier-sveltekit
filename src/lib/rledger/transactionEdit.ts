import Big from 'big.js';

interface Token {
	text: string;
	start: number;
	end: number;
}

function unsupported(): never {
	throw new Error(
		'This transaction contains source annotations that cannot be safely changed in the transaction editor. Use File Storage to edit the source; no changes were saved.'
	);
}

/** Quoted strings can span lines and contain apparent comments or posting headers. */
function header(source: string) {
	const tokens: Token[] = [];
	const pattern = /"(?:\\[\s\S]|[^"\\])*"|;[^\r\n]*|\r?\n|[^\s";]+/g;
	for (const match of source.matchAll(pattern)) {
		if (match[0].startsWith(';') || /^\r?\n$/.test(match[0])) break;
		tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(tokens[0]?.text ?? '') || !tokens[1]) unsupported();
	const strings = tokens.slice(2).filter((token) => token.text.startsWith('"'));
	if (strings.length > 2) unsupported();
	const end = strings.at(-1)?.end ?? tokens[1].end;
	const lineEnd = source.indexOf('\n', end);
	return { tokens, strings, end, body: lineEnd < 0 ? '' : source.slice(lineEnd) };
}

function firstPosting(body: string): number {
	const tokens = body.matchAll(
		/"(?:\\[\s\S]|[^"\\])*"|;[^\r\n]*|^[\t ]+(?:[^\s][\t ]+)?[\p{Lu}\p{Lt}\p{Lo}][^\s:;"]*(?::[^\s:;"]+)+(?=[\t ;]|$)/gmu
	);
	for (const token of tokens) {
		if (/^[\t ]/.test(token[0])) return token.index;
	}
	return unsupported();
}

/** Unknown syntax, flags, comments and metadata fail closed before any posting rewrite. */
function postingRows(body: string) {
	const rows: Array<{ start: number; fields: Token[] }> = [];
	let start = 0;
	for (const line of body.split('\n')) {
		if (line.trim()) {
			if (
				!/^[\t ]+[\p{Lu}\p{Lt}\p{Lo}][^\s:;"]*(?::[^\s:;"]+)+(?:[\t ]+-?(?:\d+(?:\.\d*)?|\.\d+)[\t ]+[^\s;{}@]+)?[\t ]*\r?$/u.test(
					line
				)
			)
				unsupported();
			rows.push({
				start,
				fields: [...line.matchAll(/\S+/g)].map((match) => ({
					text: match[0],
					start: start + match.index,
					end: start + match.index + match[0].length
				}))
			});
		}
		start += line.length + 1;
	}
	return rows;
}

function mergePostings(source: string, baseline: string, edited: string): string {
	const original = postingRows(source);
	const before = postingRows(baseline);
	const after = postingRows(edited);
	if (original.length !== before.length) unsupported();
	const changes: Array<{ start: number; end: number; text: string }> = [];
	const losslessProjection = original.every(({ fields: a }, index) => {
		const b = before[index].fields;
		return (
			a.length === b.length &&
			a[0].text === b[0].text &&
			(a.length === 1 || (new Big(a[1].text).eq(b[1].text) && a[2].text === b[2].text))
		);
	});
	if (before.length !== after.length) {
		// A structural edit has no stable row mapping. Only serialize a lossless projection.
		if (!losslessProjection) unsupported();
		return edited.replace(/^\r?\n/, '');
	}
	const movesAccount = after.some(
		({ fields }, index) =>
			fields[0].text !== before[index].fields[0].text &&
			before.some((row, other) => other !== index && row.fields[0].text === fields[0].text)
	);
	if (movesAccount && !losslessProjection) unsupported();
	for (let index = 0; index < before.length; index++) {
		const a = original[index].fields;
		const b = before[index].fields;
		const c = after[index].fields;
		if (b[0].text !== c[0].text) changes.push({ ...a[0], text: c[0].text });
		if (b.length === c.length && a.length === c.length) {
			for (const field of [1, 2]) {
				if (b[field]?.text !== c[field]?.text) changes.push({ ...a[field], text: c[field].text });
			}
		} else if (
			b
				.slice(1)
				.map((t) => t.text)
				.join(' ') !==
			c
				.slice(1)
				.map((t) => t.text)
				.join(' ')
		) {
			// Do not materialize an inferred number just to change its currency.
			if (a.length === 1 && b[1]?.text === c[1]?.text) unsupported();
			changes.push({
				start: a[0].end,
				end: a.at(-1)!.end,
				text:
					c.length > 1
						? `  ${c
								.slice(1)
								.map((t) => t.text)
								.join(' ')}`
						: ''
			});
		}
	}
	for (const change of changes.sort((a, b) => b.start - a.start)) {
		source = source.slice(0, change.start) + change.text + source.slice(change.end);
	}
	return source;
}

/**
 * Apply form changes to the verified source, not to the parser's lossy projection.
 * The baseline must come from the same whole-journal parse used to populate the form:
 * booking can infer units that are absent (or different when parsed in isolation).
 */
export function mergeTransactionEdit(source: string, baseline: string, edited: string): string {
	if (baseline === edited || source === edited) return source;
	const original = header(source);
	const before = header(baseline);
	const after = header(edited);
	const changes: Array<{ start: number; end: number; text: string }> = [];
	for (const index of [0, 1]) {
		if (before.tokens[index].text !== after.tokens[index].text) {
			changes.push({ ...original.tokens[index], text: after.tokens[index].text });
		}
	}
	if (before.strings.map((s) => s.text).join(' ') !== after.strings.map((s) => s.text).join(' ')) {
		if (original.strings.length === after.strings.length) {
			for (let index = 0; index < after.strings.length; index++) {
				// Compare with the form baseline, not the spelling/escaping of the source.
				const field = index === after.strings.length - 1 ? 'note' : 'payee';
				const previous =
					field === 'note'
						? before.strings.at(-1)
						: before.strings.length === 2
							? before.strings[0]
							: undefined;
				if (previous?.text !== after.strings[index].text) {
					changes.push({ ...original.strings[index], text: after.strings[index].text });
				}
			}
		} else {
			changes.push({
				start: original.strings[0]?.start ?? original.end,
				end: original.end,
				text: `${original.strings.length ? '' : ' '}${after.strings.map((s) => s.text).join(' ')}`
			});
		}
	}

	if (before.body !== after.body && original.body !== after.body) {
		const postingStart = firstPosting(original.body);
		const postings = original.body.slice(postingStart);
		const replacement = mergePostings(postings, before.body, after.body);
		// Retain transaction metadata and comments before the first posting verbatim.
		const bodyStart = source.length - original.body.length;
		changes.push({
			start: bodyStart + postingStart,
			end: source.length,
			text: replacement
		});
	}
	for (const change of changes.sort((a, b) => b.start - a.start)) {
		source = source.slice(0, change.start) + change.text + source.slice(change.end);
	}
	return source;
}
