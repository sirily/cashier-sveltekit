/**
 * Stage 2 manual transaction writeback.
 *
 * 1. Prepare local cashier.bean: ensure cashier_id on every completed * transaction.
 * 2. Push pending transactions to server POST /api/xact.
 * 3. Reconcile: remove local entries whose cashier_id appears in the pulled ledger
 *    (and was not rejected in the current push batch).
 */
import * as opfs from '$lib/utils/opfslib';
import { CASHIER_XACT_FILE } from '$lib/constants';

export interface PendingTransaction {
	rawText: string;
	cashierId: string;
}

export interface WritebackResponse {
	synchronized: string[];
	rejected: Array<{ cashier_id: string | null; reason: string }>;
}

const CASHIER_ID_RE = /^\s+cashier_id:\s*"([^"]*)"/m;
const COMPLETED_TRANSACTION_RE = /^\d{4}-\d{2}-\d{2}\s+\*\s/;
const TRANSACTION_RE = /^\d{4}-\d{2}-\d{2}\s+[*!]\s/;

function generateCashierId(): string {
	return crypto.randomUUID();
}

function extractCashierId(blockText: string): string | null {
	const match = blockText.match(CASHIER_ID_RE);
	return match ? match[1] : null;
}

function isCompletedTransactionStart(line: string): boolean {
	return COMPLETED_TRANSACTION_RE.test(line.trimStart());
}

function isTransactionStart(line: string): boolean {
	return TRANSACTION_RE.test(line.trimStart());
}

function findNextTransactionStart(lines: string[], startIndex: number): number {
	for (let i = startIndex; i < lines.length; i++) {
		if (isTransactionStart(lines[i])) return i;
	}
	return lines.length;
}

function trimTrailingBlankLines(lines: string[], startIndex: number, endIndex: number): number {
	let trimmedEnd = endIndex;
	while (trimmedEnd > startIndex && lines[trimmedEnd - 1].trim() === '') {
		trimmedEnd--;
	}
	return trimmedEnd;
}

/**
 * Read cashier.bean, find all completed `*` transactions, ensure each has a
 * persisted `cashier_id` metadata line, write back the updated file, and
 * return the list of pending (to-send) transactions with their IDs.
 *
 * Incomplete `!` transactions are ignored (not returned, not modified).
 * Transactions that already have a `cashier_id` keep it.
 */
export async function prepareLocalTransactions(): Promise<PendingTransaction[]> {
	const content = (await opfs.readFile(CASHIER_XACT_FILE)) ?? '';
	if (!content.trim()) return [];

	const lines = content.split('\n');
	const pending: PendingTransaction[] = [];
	const resultLines: string[] = [];
	let i = 0;

	while (i < lines.length) {
		if (isCompletedTransactionStart(lines[i])) {
			const nextTransactionIndex = findNextTransactionStart(lines, i + 1);
			const blockEndIndex = trimTrailingBlankLines(lines, i, nextTransactionIndex);

			const blockLines = lines.slice(i, blockEndIndex);
			const blockText = blockLines.join('\n');
			const existingId = extractCashierId(blockText);

			let cashierId: string;
			let sendBlock: string[];

			if (existingId) {
				cashierId = existingId;
				sendBlock = blockLines;
			} else {
				cashierId = generateCashierId();
				sendBlock = [
					lines[i],
					`    cashier_id: "${cashierId}"`,
					...lines.slice(i + 1, blockEndIndex)
				];
			}

			resultLines.push(...sendBlock);
			resultLines.push(...lines.slice(blockEndIndex, nextTransactionIndex));
			pending.push({ rawText: sendBlock.join('\n'), cashierId });
			i = nextTransactionIndex;
		} else {
			resultLines.push(lines[i]);
			i++;
		}
	}

	const newContent = resultLines.join('\n');
	if (newContent !== content) {
		await opfs.saveFile(CASHIER_XACT_FILE, newContent);
	}

	return pending;
}

/**
 * POST pending transactions to the server /api/xact endpoint.
 * Returns the server response or throws on network error.
 */
export async function pushTransactions(
	serverUrl: string,
	transactions: PendingTransaction[]
): Promise<WritebackResponse> {
	if (transactions.length === 0) {
		return { synchronized: [], rejected: [] };
	}

	const base = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
	const url = base.endsWith('/api') ? `${base}/xact` : `${base}/api/xact`;

	const response = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			transactions: transactions.map((t) => t.rawText)
		})
	});

	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`Server rejected request (${response.status}): ${text || response.statusText}`);
	}

	const data = (await response.json()) as WritebackResponse;
	return data;
}

/**
 * After a successful ledger pull + parse, scan all pulled `.bean` files in OPFS
 * (excluding cashier.bean itself) for `cashier_id` metadata values. Remove from
 * cashier.bean any completed transaction block whose cashier_id appears in the
 * pulled ledger and was not rejected in the current push batch.
 */
export async function reconcileLocalJournal(rejectedIds: string[]): Promise<void> {
	return reconcileLocalJournalFromPaths(rejectedIds);
}

export async function reconcileLocalJournalFromPaths(
	rejectedIds: string[],
	pulledLedgerPaths?: string[]
): Promise<void> {
	const content = (await opfs.readFile(CASHIER_XACT_FILE)) ?? '';
	if (!content.trim()) return;

	const syncedIds = await findCashierIdsInPulledLedger(pulledLedgerPaths);
	const rejectedSet = new Set(rejectedIds);
	const idsToRemove = new Set<string>();

	for (const id of syncedIds) {
		if (!rejectedSet.has(id)) {
			idsToRemove.add(id);
		}
	}

	if (idsToRemove.size === 0) return;

	const lines = content.split('\n');
	const resultLines: string[] = [];
	let i = 0;

	while (i < lines.length) {
		if (isCompletedTransactionStart(lines[i])) {
			const nextTransactionIndex = findNextTransactionStart(lines, i + 1);
			const blockEndIndex = trimTrailingBlankLines(lines, i, nextTransactionIndex);

			const blockLines = lines.slice(i, blockEndIndex);
			const blockText = blockLines.join('\n');
			const blockId = extractCashierId(blockText);

			if (blockId && idsToRemove.has(blockId)) {
				i = blockEndIndex;
				continue;
			}

			resultLines.push(...blockLines);
			resultLines.push(...lines.slice(blockEndIndex, nextTransactionIndex));
			i = nextTransactionIndex;
		} else {
			resultLines.push(lines[i]);
			i++;
		}
	}

	const newContent = resultLines.join('\n');
	if (newContent !== content) {
		await opfs.saveFile(CASHIER_XACT_FILE, newContent);
	}
}

/**
 * Scan all non-cashier .bean files in OPFS (recursively) for cashier_id metadata.
 */
async function findCashierIdsInPulledLedger(pulledLedgerPaths?: string[]): Promise<Set<string>> {
	const ids = new Set<string>();
	const paths =
		pulledLedgerPaths ??
		(await opfs.listFileTree()).filter((entry) => entry.kind === 'file').map((entry) => entry.path);

	for (const path of paths) {
		if (!path.endsWith('.bean')) continue;
		if (path === CASHIER_XACT_FILE) continue;

		const content = await opfs.readFile(path);
		if (!content) continue;

		const lines = content.split('\n');
		let i = 0;
		while (i < lines.length) {
			if (!isCompletedTransactionStart(lines[i])) {
				i++;
				continue;
			}

			const nextTransactionIndex = findNextTransactionStart(lines, i + 1);
			const blockEndIndex = trimTrailingBlankLines(lines, i, nextTransactionIndex);
			const id = extractCashierId(lines.slice(i, blockEndIndex).join('\n'));
			if (id) ids.add(id);
			i = nextTransactionIndex;
		}
	}

	return ids;
}
