import { syncFeedback } from './sync-feedback.svelte';
import { notifyBookSelectionChanged } from '#lib/services/bookSelectionEvents';
/**
 * Sync source: Cashier Server (network).
 * Fetches data from the CashierSync server over HTTP.
 */
import { settings, SettingKeys } from '#lib/settings';
import { syncHttpError } from './http-error';
import { CASHIER_XACT_FILE } from '#lib/constants';
import { readJournal } from '#lib/sync/journal-storage';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { createLedger, ensureInitialized } from '#lib/services/rustledger';
import Notifier from '#lib/utils/notifier';
import { initializeSyncProgress, updateSyncStep } from '#lib/stores/syncProgressStore';
import {
	prepareLocalTransactions,
	pushTransactions,
	reconcileLocalJournalFromPaths,
	type PendingTransaction
} from '#lib/sync/manual-writeback';

Notifier.init();

const DEFAULT_BEANCOUNT_ROOT_FILE = 'main.bean';
const INCLUDE_DIRECTIVE_REGEX = /^\s*include\s+"([^"]+)"/gm;

interface InfrastructureFileResponse {
	content: string;
}

interface InfrastructureGlobResponse {
	files: Array<{ path: string; content: string }>;
}

export interface SyncError {
	stage: 'send' | 'pull' | 'parse' | 'reconcile' | 'refresh' | 'other';
	message: string;
	cashierId?: string;
}

export interface BeancountSyncDiagnostics {
	refreshResult?: 'ok' | 'error' | 'skipped';
	ledgerFilesCount?: number;
	selectedRootBookFilename?: string;
	rootBookSize?: number;
	parseResult?: 'ok' | 'error' | 'skipped';
	parseErrorCount?: number;
	parseErrors?: string[];
	lastError?: string;
	syncErrors?: SyncError[];
}

type Redact = (text: string) => string;

function describeError(error: unknown, redact: Redact): string {
	if (error instanceof Error) return redact(error.message);
	if (typeof error === 'string') return redact(error);
	try {
		// Scrub diagnostic values before JSON escaping can change the token's spelling.
		const serialized = JSON.stringify(error, (_key, value: unknown) =>
			typeof value === 'string' ? redact(value) : value
		);
		return redact(serialized ?? String(error));
	} catch {
		return redact(String(error));
	}
}

function describeParseErrors(errors: unknown[], redact: Redact): string[] {
	return errors.map((error) => describeError(error, redact));
}

function recordSyncError(error: SyncError, redact: Redact): string {
	const { stage, message, cashierId } = error;
	const safeMessage = redact(message);
	const safeError: SyncError = { stage, message: safeMessage };
	if (cashierId !== undefined) safeError.cashierId = redact(cashierId);
	const syncErrors = syncFeedback.diagnostics?.syncErrors ?? [];
	syncFeedback.diagnostics = {
		...syncFeedback.diagnostics,
		lastError: safeMessage,
		syncErrors: [...syncErrors, safeError]
	};
	return safeMessage;
}

async function parseDownloadedLedger(
	files: Map<string, string>,
	entryPoint: string,
	redact: Redact
): Promise<{ errors: unknown[]; confirmedIds: string[] }> {
	await ensureInitialized();
	const ledger = createLedger(Object.fromEntries(files), entryPoint);
	try {
		const errors = ledger.getErrors();
		if (errors.length > 0) return { errors, confirmedIds: [] };
		// WASM 0.14.1's directives and transactions table omit metadata. ENTRIES
		// retains transaction metadata and includes transactions without postings.
		const confirmation = ledger.query(
			"SELECT DISTINCT entry_meta('cashier_id') AS cashier_id FROM entries WHERE type = 'transaction' AND flag = '*'"
		);
		if (confirmation.errors.length > 0) {
			throw new Error(
				`Failed to read server confirmation: ${describeParseErrors(confirmation.errors, redact).join('; ')}`
			);
		}
		const confirmedIds = confirmation.rows.flatMap((row) =>
			typeof row[0] === 'string' && row[0] ? [row[0]] : []
		);
		return { errors, confirmedIds };
	} finally {
		ledger.free();
	}
}

function normalizeRemotePath(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	const isAbsolute = normalized.startsWith('/');
	const stack: string[] = [];
	for (const part of normalized.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			if (stack.length === 0) throw new Error(`Invalid infrastructure path: ${path}`);
			stack.pop();
			continue;
		}
		stack.push(part);
	}
	return `${isAbsolute ? '/' : ''}${stack.join('/')}`;
}

function normalizeRootBookPath(path: string): string {
	const trimmedPath = path.trim() || DEFAULT_BEANCOUNT_ROOT_FILE;
	if (trimmedPath === '/workspace/main.bean') return DEFAULT_BEANCOUNT_ROOT_FILE;
	if (trimmedPath.startsWith('/workspace/')) return trimmedPath.slice('/workspace/'.length);
	return trimmedPath;
}

function dirname(path: string): string {
	const normalized = normalizeRemotePath(path);
	const index = normalized.lastIndexOf('/');
	if (index <= 0) return normalized.startsWith('/') ? '/' : '';
	return normalized.slice(0, index);
}

function basename(path: string): string {
	return normalizeRemotePath(path).split('/').pop() ?? '';
}

function resolveRemoteInclude(parentPath: string, includePath: string): string {
	if (includePath.startsWith('/')) return normalizeRemotePath(includePath);
	const parentDir = dirname(parentPath);
	return normalizeRemotePath(parentDir ? `${parentDir}/${includePath}` : includePath);
}

function parseIncludes(content: string): string[] {
	return Array.from(content.matchAll(INCLUDE_DIRECTIVE_REGEX), (match) => match[1]);
}

function isGlobPath(path: string): boolean {
	return path.includes('*') || path.includes('?') || path.includes('[') || path.includes(']');
}

function globPatternToRegExp(pattern: string): RegExp {
	let source = '^';
	for (const char of pattern) {
		if (char === '*') {
			source += '[^/]*';
		} else if (char === '?') {
			source += '[^/]';
		} else {
			source += char.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
		}
	}
	return new RegExp(`${source}$`);
}

function expandIncludeDirective(
	resolvedRemotePath: string,
	localByRemotePath: Map<string, string>
): string[] {
	if (!isGlobPath(resolvedRemotePath)) {
		const localPath = localByRemotePath.get(resolvedRemotePath);
		if (!localPath) {
			throw new Error(`Included file is outside the selected root tree: ${resolvedRemotePath}`);
		}
		return [localPath];
	}

	const regex = globPatternToRegExp(resolvedRemotePath);
	const matches = Array.from(localByRemotePath.entries())
		.filter(([remotePath]) => regex.test(remotePath))
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, localPath]) => localPath);
	if (matches.length === 0) {
		throw new Error(`Included file is outside the selected root tree: ${resolvedRemotePath}`);
	}
	return matches;
}

function mapRemoteFilesToLocalPaths(
	rootRemotePath: string,
	remoteFiles: Map<string, string>
): Map<string, string> {
	const rootDir = dirname(rootRemotePath);
	const rootLocalName = basename(rootRemotePath);
	const localFiles = new Map<string, string>();
	for (const [remotePath, content] of remoteFiles) {
		let localPath = remotePath === rootRemotePath ? rootLocalName : '';
		if (!localPath) {
			const prefix = rootDir === '/' ? '/' : rootDir ? `${rootDir}/` : '';
			if (!remotePath.startsWith(prefix)) {
				throw new Error(`Included file is outside the selected root tree: ${remotePath}`);
			}
			localPath = normalizeRemotePath(remotePath.slice(prefix.length));
		}
		if (!localPath || localPath.startsWith('/') || localPath.split('/').includes('..')) {
			throw new Error(`Invalid local OPFS path for ${remotePath}`);
		}
		localFiles.set(localPath, content);
	}
	return localFiles;
}

function rewriteIncludesToLocalPaths(
	rootRemotePath: string,
	localFiles: Map<string, string>
): Map<string, string> {
	const localByRemotePath = new Map<string, string>();
	const rootDir = dirname(rootRemotePath);
	const rootLocalName = basename(rootRemotePath);

	for (const localPath of localFiles.keys()) {
		const remotePath =
			localPath === rootLocalName
				? rootRemotePath
				: normalizeRemotePath(rootDir ? `${rootDir}/${localPath}` : localPath);
		localByRemotePath.set(remotePath, localPath);
	}

	const rewritten = new Map<string, string>();
	for (const [localPath, content] of localFiles) {
		const remotePath =
			localPath === rootLocalName
				? rootRemotePath
				: localByRemotePath
					? Array.from(localByRemotePath.entries()).find(
							([, candidate]) => candidate === localPath
						)?.[0]
					: undefined;
		const sourceRemotePath = remotePath ?? rootRemotePath;
		const nextContent = content.replace(
			INCLUDE_DIRECTIVE_REGEX,
			(directive, includePath: string) => {
				const resolvedRemotePath = resolveRemoteInclude(sourceRemotePath, includePath);
				const targetLocalPaths = expandIncludeDirective(resolvedRemotePath, localByRemotePath);
				return targetLocalPaths
					.map((targetLocalPath) => directive.replace(includePath, targetLocalPath))
					.join('\n');
			}
		);
		rewritten.set(localPath, nextContent);
	}
	return rewritten;
}

function ensureSafeLocalLedgerFiles(files: Map<string, string>): void {
	for (const [path, content] of files) {
		if (path === CASHIER_XACT_FILE) {
			throw new Error('Downloaded infrastructure cannot overwrite cashier.bean');
		}
		if (content === undefined || content === null) {
			throw new Error(`Downloaded file is empty: ${path}`);
		}
	}
}

// Snapshot recovery cannot use OPFS helpers that turn inaccessible storage into
// an absent file or silently skip a write when obtaining a handle fails.
async function snapshotFileHandle(path: string, create = false): Promise<FileSystemFileHandle> {
	let directory = await navigator.storage.getDirectory();
	const parts = path.split('/');
	const name = parts.pop()!;
	for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
	return directory.getFileHandle(name, { create });
}

async function readSnapshotFile(path: string): Promise<string | undefined> {
	if (path === CASHIER_XACT_FILE) return readJournal();
	let handle: FileSystemFileHandle;
	try {
		handle = await snapshotFileHandle(path);
	} catch (error) {
		if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
		throw error;
	}
	return (await handle.getFile()).text();
}

async function saveSnapshotFile(path: string, content: string): Promise<void> {
	const handle = await snapshotFileHandle(path, true);
	const stream = await handle.createWritable();
	try {
		// A journal may have appeared since the absence check. Never replace it
		// with an empty overlay, including while rolling back a failed pull.
		if (path === CASHIER_XACT_FILE && (await readJournal()) !== '') {
			await stream.abort();
			return;
		}
		await stream.write(new TextEncoder().encode(content));
		if (path === CASHIER_XACT_FILE && (await readJournal()) !== '') {
			await stream.abort();
			return;
		}
		await stream.close();
	} catch (error) {
		try {
			await stream.abort();
		} catch {
			// Keep the original persistence failure for the recovery diagnostics.
		}
		throw error;
	}
}

async function removeSnapshotFile(path: string): Promise<void> {
	try {
		let directory = await navigator.storage.getDirectory();
		const parts = path.split('/');
		const name = parts.pop()!;
		for (const part of parts) directory = await directory.getDirectoryHandle(part);
		if (path === CASHIER_XACT_FILE) {
			const current = await readJournal();
			if (current === undefined) return;
			if (current !== '') throw new Error('Journal changed during Sync; preserved local content');
		}
		await directory.removeEntry(name);
	} catch (error) {
		if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
	}
}

async function snapshotExistingFiles(paths: string[]): Promise<Map<string, string | undefined>> {
	const snapshot = new Map<string, string | undefined>();
	for (const path of paths) snapshot.set(path, await readSnapshotFile(path));
	return snapshot;
}

async function restoreFiles(
	snapshot: Map<string, string | undefined>,
	redact: Redact
): Promise<string[]> {
	const errors: string[] = [];
	for (const [path, content] of snapshot) {
		try {
			if (content === undefined) {
				await removeSnapshotFile(path);
			} else {
				await saveSnapshotFile(path, content);
			}
		} catch (error) {
			errors.push(`${path}: ${describeError(error, redact)}`);
		}
	}
	return errors;
}

/**
 * Cashier Sync class communicates with the CashierSync server over network.
 * The methods here represent the methods implemented by the server.
 * This is a proxy class for fetching Ledger data.
 */
type CashierRequestOptions = RequestInit & { timeout?: number };

class CashierSyncBeancount {
	serverUrl: string;
	apiToken: string;

	constructor(serverUrl: string, apiToken = '') {
		if (!serverUrl) {
			throw new Error('CashierSync URL not set.');
		}
		if (serverUrl.endsWith('/')) {
			serverUrl = serverUrl.substring(0, serverUrl.length - 1);
		}
		this.serverUrl = serverUrl;
		this.apiToken = apiToken.trim();
	}

	private requestOptions(options?: CashierRequestOptions): RequestInit {
		const { timeout: _timeout, ...fetchOptions } = options ?? {};
		const headers = new Headers(options?.headers);
		if (this.apiToken) headers.set('Authorization', `Bearer ${this.apiToken}`);
		return { ...fetchOptions, headers };
	}

	async get(path: string, options?: CashierRequestOptions) {
		const url = new URL(`${this.serverUrl}${path}`);
		const response = await fetch(url, this.requestOptions(options));
		return response;
	}

	/**
	 * See if the server is running
	 */
	async healthCheck(): Promise<string> {
		const result = await this.get('/ping');
		if (!result.ok) {
			throw new Error('Error contacting Cashier server!');
		}

		const text = await result.text();
		return text;
	}

	async readFiles(filePath: string): Promise<Map<string, string>> {
		const url = new URL(`${this.serverUrl}/infrastructure`);
		url.searchParams.append('file_path', filePath);
		const response = await fetch(url, this.requestOptions());
		if (!response.ok) {
			throw syncHttpError(response.status, 'Downloading book');
		}

		const json = (await response.json()) as InfrastructureFileResponse | InfrastructureGlobResponse;
		if ('files' in json) {
			return new Map(json.files.map((file) => [normalizeRemotePath(file.path), file.content]));
		}
		return new Map([[normalizeRemotePath(filePath), json.content]]);
	}

	async readLedgerFiles(rootFilePath: string): Promise<Map<string, string>> {
		const rootPath = normalizeRemotePath(normalizeRootBookPath(rootFilePath));
		const files = new Map<string, string>();
		const visiting = new Set<string>();

		const visit = async (remotePath: string) => {
			if (files.has(remotePath)) return;
			if (visiting.has(remotePath)) return;
			visiting.add(remotePath);
			const downloadedFiles = await this.readFiles(remotePath);
			for (const [downloadedPath, content] of downloadedFiles) {
				files.set(downloadedPath, content);
				for (const includePath of parseIncludes(content)) {
					await visit(resolveRemoteInclude(downloadedPath, includePath));
				}
			}
			visiting.delete(remotePath);
		};

		await visit(rootPath);
		return files;
	}
}

/**
 * Entry point
 * @returns
 */
async function synchronize(): Promise<boolean> {
	initializeSyncProgress();
	syncFeedback.diagnostics = { parseResult: 'skipped', refreshResult: 'skipped', syncErrors: [] };
	const activeUrl = await settings.get<string>(SettingKeys.syncServerUrl);
	if (!activeUrl) return false;
	const apiToken = (await settings.get<string>(SettingKeys.syncApiToken))?.trim() ?? '';
	// This credential belongs to this run. The Settings form may change before a response arrives.
	const escapedToken = JSON.stringify(apiToken).slice(1, -1);
	const redact: Redact = (message) => {
		if (!apiToken) return message;
		// Also cover JSON property names and diagnostic text already formatted upstream.
		if (escapedToken !== apiToken) message = message.replaceAll(escapedToken, '[redacted]');
		return message.replaceAll(apiToken, '[redacted]');
	};
	const sync = new CashierSyncBeancount(activeUrl, apiToken);
	let hasRetryableWritebackFailure = false;
	let bookSelectionChanged = false;
	try {
		// Send completed local entries before pulling the authoritative book.
		updateSyncStep(0, 'in-progress');
		const rejectedIds: string[] = [];
		let accepted: PendingTransaction[] = [];
		try {
			const pending = await prepareLocalTransactions();
			if (pending.length > 0) {
				const response = await pushTransactions(activeUrl, pending, apiToken);
				if (
					!response ||
					!Array.isArray(response.synchronized) ||
					!response.synchronized.every((id) => typeof id === 'string') ||
					!Array.isArray(response.rejected) ||
					!response.rejected.every(
						(rejection) =>
							rejection &&
							(typeof rejection.cashier_id === 'string' || rejection.cashier_id === null) &&
							typeof rejection.reason === 'string'
					)
				)
					throw new Error('Malformed transaction writeback response');
				const rejected = new Set(response.rejected.map((entry) => entry.cashier_id));
				const synchronized = new Set(response.synchronized);
				accepted = pending.filter(
					(entry) => synchronized.has(entry.cashierId) && !rejected.has(entry.cashierId)
				);
				const synced = accepted.length;
				if (synced > 0) {
					Notifier.success(`Sent ${synced} transaction(s)`);
				}
				for (const r of response.rejected) {
					if (r.cashier_id) rejectedIds.push(r.cashier_id);
					const message = r.reason || 'Transaction rejected';
					Notifier.warning(
						recordSyncError(
							{ stage: 'send', message, cashierId: r.cashier_id ?? undefined },
							redact
						)
					);
				}
				const unresolved = pending.filter(
					(entry) => !synchronized.has(entry.cashierId) && !rejected.has(entry.cashierId)
				);
				for (const entry of unresolved) {
					const message = 'Server omitted the transaction outcome; retry Sync to resolve it.';
					Notifier.warning(
						recordSyncError({ stage: 'send', message, cashierId: entry.cashierId }, redact)
					);
				}
				if (response.rejected.length > 0 || unresolved.length > 0) {
					hasRetryableWritebackFailure = true;
					updateSyncStep(0, 'error');
				} else {
					updateSyncStep(0, 'completed');
				}
			} else {
				updateSyncStep(0, 'completed');
			}
		} catch (error) {
			accepted = [];
			hasRetryableWritebackFailure = true;
			const message = `Failed to send local transactions: ${describeError(error, redact)}`;
			Notifier.warning(recordSyncError({ stage: 'send', message }, redact));
			updateSyncStep(0, 'error');
		}

		const downloaded = await synchronizeLedgerFiles(sync, redact);
		const { paths, confirmedIds } = downloaded;
		bookSelectionChanged = downloaded.bookSelectionChanged;

		// Persist confirmed overlay removal before refreshing the combined book.
		updateSyncStep(9, 'in-progress');
		try {
			await reconcileLocalJournalFromPaths(rejectedIds, paths, { accepted, confirmedIds });
			updateSyncStep(9, 'completed');
		} catch (error) {
			hasRetryableWritebackFailure = true;
			const message = `Failed to reconcile local journal: ${describeError(error, redact)}`;
			const safeMessage = recordSyncError({ stage: 'reconcile', message }, redact);
			updateSyncStep(9, 'error');
			Notifier.warning(safeMessage);
			return false;
		}
		try {
			await fullLedgerService.deleteCache();
			await fullLedgerService.invalidate();
			syncFeedback.diagnostics = { ...syncFeedback.diagnostics, refreshResult: 'ok' };
		} catch (error) {
			hasRetryableWritebackFailure = true;
			recordSyncError(
				{
					stage: 'refresh',
					message: `Failed to refresh local analysis: ${describeError(error, redact)}`
				},
				redact
			);
			syncFeedback.diagnostics = { ...syncFeedback.diagnostics, refreshResult: 'error' };
		}
	} catch (error) {
		const message = describeError(error, redact);
		// Do not log the original error: its stack, cause or other fields could contain the token.
		console.error(new Error(message));
		if ((syncFeedback.diagnostics?.syncErrors?.length ?? 0) === 0) {
			recordSyncError({ stage: 'other', message }, redact);
		}
		Notifier.error(message);
		return false;
	} finally {
		// The downloaded files, selected root and journal reconciliation are settled now.
		if (bookSelectionChanged) notifyBookSelectionChanged();
	}
	return !hasRetryableWritebackFailure;
}

async function synchronizeLedgerFiles(
	sync: CashierSyncBeancount,
	redact: Redact
): Promise<{ paths: string[]; confirmedIds: string[]; bookSelectionChanged: boolean }> {
	let stage: SyncError['stage'] = 'pull';
	let step = 6;
	let previousBookFilename: string | null = null;
	let selectingBook = false;
	const attemptedWrites = new Map<string, string | undefined>();

	updateSyncStep(step, 'in-progress');
	try {
		const rootFilePath = normalizeRootBookPath(
			(await settings.get<string>(SettingKeys.syncBeancountRootFile)) ?? DEFAULT_BEANCOUNT_ROOT_FILE
		);
		previousBookFilename = await settings.get<string>(SettingKeys.bookFilename);
		const remoteFiles = await sync.readLedgerFiles(rootFilePath);
		const localFiles = rewriteIncludesToLocalPaths(
			normalizeRemotePath(rootFilePath),
			mapRemoteFilesToLocalPaths(normalizeRemotePath(rootFilePath), remoteFiles)
		);
		const selectedRootBookFilename = basename(rootFilePath);
		const rootBook = localFiles.get(selectedRootBookFilename);
		if (rootBook === undefined) throw new Error('Downloaded root book is missing');
		if (rootBook.trim().length === 0) throw new Error('Downloaded root book is empty');
		ensureSafeLocalLedgerFiles(localFiles);
		syncFeedback.diagnostics = {
			...syncFeedback.diagnostics,
			ledgerFilesCount: localFiles.size,
			selectedRootBookFilename: redact(selectedRootBookFilename),
			rootBookSize: rootBook.length
		};
		updateSyncStep(step, 'completed');

		stage = 'parse';
		step = 8;
		updateSyncStep(step, 'in-progress');
		const { errors, confirmedIds } = await parseDownloadedLedger(
			localFiles,
			selectedRootBookFilename,
			redact
		);
		syncFeedback.diagnostics = {
			...syncFeedback.diagnostics,
			parseResult: errors.length > 0 ? 'error' : 'ok',
			parseErrorCount: errors.length,
			parseErrors: describeParseErrors(errors, redact)
		};
		if (errors.length > 0) {
			throw new Error(
				`Full ledger parsed with ${errors.length} errors for ${selectedRootBookFilename}`
			);
		}
		updateSyncStep(step, 'completed');

		stage = 'pull';
		step = 6;
		updateSyncStep(step, 'in-progress');
		const snapshot = await snapshotExistingFiles([...localFiles.keys(), CASHIER_XACT_FILE]);
		const writes = new Map(localFiles);
		if (snapshot.get(CASHIER_XACT_FILE) === undefined) writes.set(CASHIER_XACT_FILE, '');
		for (const [path, content] of writes) {
			// A failed write can already have changed storage, so recover it too.
			attemptedWrites.set(path, snapshot.get(path));
			await saveSnapshotFile(path, content);
		}
		updateSyncStep(step, 'completed');

		stage = 'other';
		step = 7;
		updateSyncStep(step, 'in-progress');
		selectingBook = true;
		await settings.set(SettingKeys.bookFilename, selectedRootBookFilename);
		updateSyncStep(step, 'completed');
		Notifier.success('Ledger files downloaded to OPFS');
		return {
			paths: Array.from(localFiles.keys()),
			confirmedIds,
			bookSelectionChanged: previousBookFilename !== selectedRootBookFilename
		};
	} catch (error) {
		recordSyncError({ stage, message: describeError(error, redact) }, redact);
		if (stage === 'parse') {
			syncFeedback.diagnostics = { ...syncFeedback.diagnostics, parseResult: 'error' };
		}
		updateSyncStep(step, 'error');
		const recoveryErrors = await restoreFiles(attemptedWrites, redact);
		if (selectingBook) {
			try {
				await settings.set(SettingKeys.bookFilename, previousBookFilename);
			} catch (recoveryError) {
				recoveryErrors.push(`Selected root: ${describeError(recoveryError, redact)}`);
			}
		}
		for (const message of recoveryErrors) {
			recordSyncError({ stage: 'pull', message: `Incomplete book recovery: ${message}` }, redact);
		}
		throw error;
	}
}

function getLastDiagnostics() {
	return syncFeedback.diagnostics;
}

const __test__ = {
	normalizeRemotePath,
	normalizeRootBookPath,
	parseIncludes,
	resolveRemoteInclude,
	mapRemoteFilesToLocalPaths,
	rewriteIncludesToLocalPaths
};

export { CashierSyncBeancount, synchronize, getLastDiagnostics, __test__ };
