/** Prepare, submit, and safely reconcile the pending manual journal. */

import { readJournal, saveJournal } from './journal-storage';
import { syncHttpError } from './http-error';

export interface PendingTransaction {
	rawText: string;
	cashierId: string;
}

export interface WritebackResponse {
	synchronized: string[];
	rejected: Array<{ cashier_id: string | null; reason: string }>;
}

const COMPLETED_TRANSACTION_RE = /^[\t ]*\d{4}-\d{2}-\d{2}[\t ]+\*[\t ]/;

function generateCashierId(): string {
	return crypto.randomUUID();
}

function extractCashierId(blockText: string): string | null {
	// Skip strings/comments before recognizing metadata, and stop at the first posting:
	// any later cashier_id belongs to a posting, not the transaction.
	const tokens = blockText.matchAll(
		/"(?:\\[\s\S]|[^"\\])*"|;[^\r\n]*|^[\t ]+(?:[^\s][\t ]+)?[\p{Lu}\p{Lt}\p{Lo}][^\s:;"]*(?::[^\s:;"]+)+(?=[\t ;]|$)|^[\t ]+cashier_id:[\t ]*"([^"\r\n]*)"/gmu
	);
	for (const match of tokens) {
		if (match[1] !== undefined) return match[1];
		if (/^[\t ]/.test(match[0])) break;
	}
	return null;
}

interface TransactionBlock {
	start: number;
	end: number;
	rawText: string;
}

/** Dated directives may be indented; preserve their source without absorbing neighboring entries. */
function completedBlocks(content: string): TransactionBlock[] {
	const starts: number[] = [];
	// Consume strings and comments first so multiline strings cannot invent directives.
	for (const token of content.matchAll(
		/"(?:\\[\s\S]|[^"\\])*"|;[^\r\n]*|^[\t ]*\d{4}-\d{2}-\d{2}(?=[\t ])|^[^\s;"\r\n]+/gm
	)) {
		if (token[0].startsWith('"')) continue;
		if (token[0].startsWith(';') && token.index > 0 && content[token.index - 1] !== '\n') continue;
		starts.push(token.index);
	}
	const blocks: TransactionBlock[] = [];
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i];
		if (!COMPLETED_TRANSACTION_RE.test(content.slice(start))) continue;
		const limit = starts[i + 1] ?? content.length;
		const rawText = content.slice(start, limit).replace(/(?:\r?\n[\t ]*)+$/, '');
		blocks.push({ start, end: start + rawText.length, rawText });
	}
	return blocks;
}

function withCashierId(rawText: string, cashierId: string): string {
	// The first physical newline may be inside a multiline payee/narration.
	for (const token of rawText.matchAll(/"(?:\\[\s\S]|[^"\\])*"|;[^\r\n]*|\r?\n/g)) {
		if (token[0] !== '\n' && token[0] !== '\r\n') continue;
		const offset = token.index + token[0].length;
		return `${rawText.slice(0, offset)}    cashier_id: "${cashierId}"${token[0]}${rawText.slice(offset)}`;
	}
	return `${rawText}\n    cashier_id: "${cashierId}"`;
}

/** Persist missing identities before returning any batch to the caller. Drafts remain untouched. */
export async function prepareLocalTransactions(): Promise<PendingTransaction[]> {
	const content = (await readJournal()) ?? '';
	if (!content.trim()) return [];

	const pending: PendingTransaction[] = [];
	let newContent = '';
	let offset = 0;
	for (const block of completedBlocks(content)) {
		const existingId = extractCashierId(block.rawText);
		const cashierId = existingId || generateCashierId();
		const rawText = existingId ? block.rawText : withCashierId(block.rawText, cashierId);
		newContent += content.slice(offset, block.start) + rawText;
		offset = block.end;
		pending.push({ rawText, cashierId });
	}
	newContent += content.slice(offset);
	if (newContent !== content) await saveJournal(content, newContent);
	else if ((await readJournal()) !== content) {
		throw new Error('Local journal changed during preparation; retry Sync.');
	}
	return pending;
}

/** POST raw transactions; malformed results leave the send outcome unresolved. */
export async function pushTransactions(
	serverUrl: string,
	transactions: PendingTransaction[],
	apiToken = ''
): Promise<WritebackResponse> {
	if (transactions.length === 0) return { synchronized: [], rejected: [] };

	const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
	const url = base.endsWith('/api') ? `${base}/xact` : `${base}/api/xact`;
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (apiToken.trim()) headers.Authorization = `Bearer ${apiToken.trim()}`;
	const response = await fetch(url, {
		method: 'POST',
		headers,
		body: JSON.stringify({ transactions: transactions.map((t) => t.rawText) })
	});
	if (!response.ok) throw syncHttpError(response.status, 'Sending local transactions');

	const data: unknown = await response.json();
	if (
		!data ||
		typeof data !== 'object' ||
		!('synchronized' in data) ||
		!Array.isArray(data.synchronized) ||
		!data.synchronized.every((id: unknown) => typeof id === 'string' && id.trim().length > 0) ||
		!('rejected' in data) ||
		!Array.isArray(data.rejected) ||
		!data.rejected.every(
			(entry: unknown) =>
				entry !== null &&
				typeof entry === 'object' &&
				'cashier_id' in entry &&
				(entry.cashier_id === null ||
					(typeof entry.cashier_id === 'string' && entry.cashier_id.trim().length > 0)) &&
				'reason' in entry &&
				typeof entry.reason === 'string' &&
				entry.reason.trim().length > 0
		)
	) {
		throw new Error(
			'Sending local transactions: malformed response; send outcomes are unresolved.'
		);
	}
	return data as WritebackResponse;
}

/**
 * Runtime supplies acceptance of the exact sent source plus IDs from the parsed server-only book.
 */
export async function reconcileLocalJournalFromPaths(
	rejectedIds: string[],
	_pulledLedgerPaths: string[] | undefined,
	confirmation: { accepted: PendingTransaction[]; confirmedIds: string[] }
): Promise<void> {
	if (
		!confirmation ||
		!Array.isArray(confirmation.accepted) ||
		!Array.isArray(confirmation.confirmedIds)
	) {
		throw new Error('Reconciliation requires explicit acceptance and parsed server confirmation.');
	}
	const content = (await readJournal()) ?? '';
	if (!content.trim()) return;

	const syncedIds = new Set(confirmation.confirmedIds);
	const rejectedSet = new Set(rejectedIds);
	let newContent = '';
	let offset = 0;
	for (const block of completedBlocks(content)) {
		const id = extractCashierId(block.rawText);
		const accepted = confirmation.accepted.some(
			(entry) => entry.cashierId === id && entry.rawText === block.rawText
		);
		if (id && accepted && syncedIds.has(id) && !rejectedSet.has(id)) {
			newContent += content.slice(offset, block.start);
			offset = block.end;
		}
	}
	newContent += content.slice(offset);
	if (newContent !== content) await saveJournal(content, newContent);
}
