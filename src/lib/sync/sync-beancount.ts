/**
 * Sync source: Cashier Server (network).
 * Fetches data from the CashierSync server over HTTP.
 */
import { settings, SettingKeys } from '$lib/settings';
import moment from 'moment';
import { CASHIER_XACT_FILE, ISODATEFORMAT } from '$lib/constants';
import * as opfs from '$lib/utils/opfslib';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import { getQueries } from './sync-queries';
import type { Queries } from './sync-queries';
import Notifier from '$lib/utils/notifier';
import * as SyncCommon from '$lib/sync/sync-common';
import type { SyncSteps } from '$lib/sync/sync-common';
import { initializeSyncProgress, updateSyncStep } from '$lib/stores/syncProgressStore';
import { PtaSystems } from '$lib/enums';
import {
	prepareLocalTransactions,
	pushTransactions,
	reconcileLocalJournalFromPaths
} from '$lib/sync/manual-writeback';

Notifier.init();

const DEFAULT_BEANCOUNT_ROOT_FILE = 'main.bean';
const INCLUDE_DIRECTIVE_REGEX = /^\s*include\s+"([^"]+)"/gm;

interface InfrastructureFileResponse {
	content: string;
}

interface InfrastructureGlobResponse {
	files: Array<{ path: string; content: string }>;
}

export interface BeancountSyncDiagnostics {
	syncMode?: 'metadata-only' | 'offline-ledger';
	accountsCount?: number;
	payeesCount?: number;
	ledgerFilesCount?: number;
	selectedRootBookFilename?: string;
	rootBookSize?: number;
	parseResult?: 'ok' | 'error' | 'skipped';
	parseErrorCount?: number;
	parseErrors?: string[];
	lastError?: string;
}

let lastDiagnostics: BeancountSyncDiagnostics | null = null;

function describeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === 'string') return error;
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

function describeParseErrors(errors: unknown[]): string[] {
	return errors.map(describeError);
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

async function snapshotExistingFiles(paths: string[]): Promise<Map<string, string | undefined>> {
	const snapshot = new Map<string, string | undefined>();
	for (const path of paths) {
		snapshot.set(path, await opfs.readFile(path));
	}
	return snapshot;
}

async function restoreFiles(snapshot: Map<string, string | undefined>) {
	for (const [path, content] of snapshot) {
		if (content === undefined) {
			await opfs.deleteFile(path);
		} else {
			await opfs.saveFile(path, content);
		}
	}
}

/**
 * Cashier Sync class communicates with the CashierSync server over network.
 * The methods here represent the methods implemented by the server.
 * This is a proxy class for fetching Ledger data.
 */
class CashierSyncBeancount {
	serverUrl: string;
	queries: Queries;
	ptaSystem: PtaSystems;

	constructor(serverUrl: string) {
		if (!serverUrl) {
			throw new Error('CashierSync URL not set.');
		}
		if (serverUrl.endsWith('/')) {
			serverUrl = serverUrl.substring(0, serverUrl.length - 1);
		}
		this.serverUrl = serverUrl;

		this.ptaSystem = PtaSystems.beancount;
		this.queries = getQueries(this.ptaSystem);
	}

	async get(path: string, options?: object) {
		const url = new URL(`${this.serverUrl}${path}`);
		const response = await fetch(url, options);
		return response;
	}

	createUrl(query: string): URL {
		const url = new URL(this.serverUrl);
		url.searchParams.set('query', query);
		return url;
	}

	/**
	 * Sends a ledger query to the Ledger server and returns the response.
	 */
	async send(query: string, options?: object) {
		const url = this.createUrl(query);
		const response = await fetch(url, options);
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

	async reloadData() {
		const response = await this.get('/reload');
		if (!response.ok) {
			throw new Error('Error reloading data!');
		}
	}

	/**
	 * Retrieve the list of accounts with their balances.
	 */
	async readAccounts(): Promise<Record<string, unknown>> {
		const accountsQuery = this.queries.accounts();
		const response = await this.send(accountsQuery);
		if (!response.ok) {
			throw new Error('Error reading accounts!');
		}

		const content = await response.json();

		return content;
	}

	/**
	 * Retrieve the account balances for all accounts.
	 */
	async readBalances(): Promise<string[]> {
		const balancesQuery = this.queries.balances();
		const response = await this.send(balancesQuery);
		const content: string[] = await response.json();

		return content;
	}

	/**
	 * Get current account values in the base currency.
	 */
	async readCurrentValues(): Promise<any> {
		const rootAccount = (await settings.get(SettingKeys.rootInvestmentAccount)) as string;
		if (!rootAccount) {
			throw new Error('No root investment account set!');
		}
		const currency = await settings.get<string>(SettingKeys.currency);
		if (!currency) {
			throw new Error('No default currency set!');
		}

		const query = this.queries.currentValues(rootAccount, currency);
		const response = await this.send(query);
		const result: any = await response.json();

		return result;
	}

	/**
	 * Read infrastructure files from Cashier server.
	 */
	async readFile(filePath: string): Promise<string> {
		const files = await this.readFiles(filePath);
		const content = files.get(normalizeRemotePath(filePath));
		if (content === undefined) {
			throw new Error(`Error reading infrastructure file: ${filePath}`);
		}
		return content;
	}

	async readFiles(filePath: string): Promise<Map<string, string>> {
		const url = new URL(`${this.serverUrl}/infrastructure`);
		url.searchParams.append('file_path', filePath);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Error reading infrastructure file: ${filePath}`);
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

	async readLots(symbol: string) {
		const query = this.queries.lots(symbol);

		const response = await this.send(query);
		if (!response.ok) throw new Error('error fetching lots: ' + response.text());

		const result: string[] = await response.json();

		// remove "Assets" account title
		const lastIndex = result.length - 1;
		const lastLine = result[lastIndex];
		if (lastLine.includes('Assets')) {
			const parts = lastLine.split('Assets');
			const value = parts[0];
			result[lastIndex] = value;
		}

		return result;
	}

	/**
	 * Retrieve the list of Payees
	 */
	async readPayees(): Promise<string[]> {
		const from = moment().subtract(20, 'years').format(ISODATEFORMAT);

		const query = this.queries.payees(from);
		const response = await this.send(query, { timeout: 20000 });
		if (!response.ok) {
			throw new Error('Error reading payees!');
		}

		let content = (await response.json()) as string[];

		if (this.ptaSystem === PtaSystems.beancount) {
			content = content.map((subArray) => subArray[0]);
		}

		return content;
	}
}

/**
 * Entry point
 * @returns
 */
async function synchronize(syncOptions?: SyncSteps): Promise<boolean> {
	// defaults
	if (!syncOptions) {
		syncOptions = {
			syncAccounts: true,
			syncAaValues: false,
			syncAssetAllocation: false,
			syncPayees: true,
			syncLedgerFiles: true
		};
	}

	// Initialize sync progress
	initializeSyncProgress();
	lastDiagnostics = {
		syncMode: syncOptions.syncLedgerFiles ? 'offline-ledger' : 'metadata-only',
		parseResult: syncOptions.syncLedgerFiles ? 'skipped' : 'skipped'
	};

	// Cashier Sync synchronization

	// const activeUrl = getActiveServerUrlOrNotify();
	const activeUrl = await settings.get<string>(SettingKeys.syncServerUrl);
	if (!activeUrl) return false;

	// const _ptaSystem = (await settings.get(SettingKeys.ptaSystem)) as PtaSystems;
	const sync = new CashierSyncBeancount(activeUrl);
	let hasRetryableWritebackFailure = false;

	try {
		if (syncOptions.syncAccounts) {
			updateSyncStep(1, 'in-progress');
			try {
				await synchronizeAccounts(sync);
			} catch (error) {
				updateSyncStep(1, 'error');
				throw error;
			}
			updateSyncStep(1, 'completed');
		}

		// Asset Allocation definition (.toml)
		if (syncOptions.syncAssetAllocation) {
			updateSyncStep(3, 'in-progress');
			updateSyncStep(3, 'error');
			throw new Error('Stage 1 sync does not support asset allocation definition import');
		}

		if (syncOptions.syncAaValues) {
			updateSyncStep(4, 'in-progress');
			try {
				await synchronizeAaValues(sync);
			} catch (error) {
				updateSyncStep(4, 'error');
				throw error;
			}
			updateSyncStep(4, 'completed');
		}
		if (syncOptions.syncPayees) {
			updateSyncStep(5, 'in-progress');
			try {
				await synchronizePayees(sync);
			} catch (error) {
				updateSyncStep(5, 'error');
				throw error;
			}
			updateSyncStep(5, 'completed');
		}
		if (syncOptions.syncLedgerFiles) {
			// Stage 2 writeback: push local completed transactions before pulling
			updateSyncStep(0, 'in-progress');
			const rejectedIds: string[] = [];
			try {
				const pending = await prepareLocalTransactions();
				if (pending.length > 0) {
					const response = await pushTransactions(activeUrl, pending);
					const synced = response.synchronized.length;
					if (synced > 0) {
						Notifier.success(`Отправлено ${synced} операций`);
					}
					for (const r of response.rejected) {
						if (r.cashier_id) rejectedIds.push(r.cashier_id);
						Notifier.warning(r.reason || 'Операция отклонена');
					}
					if (response.rejected.length > 0) {
						hasRetryableWritebackFailure = true;
						updateSyncStep(0, 'error');
					} else {
						updateSyncStep(0, 'completed');
					}
				} else {
					updateSyncStep(0, 'completed');
				}
			} catch (error) {
				hasRetryableWritebackFailure = true;
				Notifier.warning(`Не удалось отправить локальные операции: ${describeError(error)}`);
				updateSyncStep(0, 'error');
			}

			const pulledLedgerPaths = await synchronizeLedgerFiles(sync);

			// Stage 2 writeback: reconcile local journal after successful pull
			updateSyncStep(9, 'in-progress');
			try {
				await reconcileLocalJournalFromPaths(rejectedIds, pulledLedgerPaths);
				updateSyncStep(9, 'completed');
			} catch {
				hasRetryableWritebackFailure = true;
				updateSyncStep(9, 'error');
				Notifier.warning('Не удалось выполнить сверку локального журнала');
			}
		}
	} catch (error: any) {
		console.error(error);
		Notifier.error(error.message);
		return false;
	}

	return !hasRetryableWritebackFailure;
}

async function synchronizeAccounts(sync: CashierSyncBeancount) {
	const response = await sync.readAccounts();
	await SyncCommon.syncAccounts(sync.ptaSystem, response);
	const accountsCount =
		typeof response === 'object' &&
		response !== null &&
		'rows' in response &&
		Array.isArray(response.rows)
			? response.rows.length
			: Object.keys(response).length;
	lastDiagnostics = { ...lastDiagnostics, accountsCount };
	Notifier.success('Accounts fetched from Ledger');
}

async function synchronizeAaValues(sync: CashierSyncBeancount) {
	const result = await sync.readCurrentValues();
	await SyncCommon.syncCurrentValues(sync.ptaSystem, result);
	Notifier.success('Asset Allocation values loaded');
}

async function synchronizePayees(sync: CashierSyncBeancount) {
	const response = await sync.readPayees();
	await SyncCommon.syncPayees(response);
	lastDiagnostics = { ...lastDiagnostics, payeesCount: response.length };
	Notifier.success('Payees fetched from Ledger');
}

async function ensureCashierFileExists() {
	if (await opfs.fileExists(CASHIER_XACT_FILE)) return;
	await opfs.saveFile(CASHIER_XACT_FILE, '');
}

async function persistLedgerFiles(files: Map<string, string>) {
	for (const [path, content] of files) {
		await opfs.saveFile(path, content);
	}
}

async function synchronizeLedgerFiles(sync: CashierSyncBeancount): Promise<string[]> {
	let previousBookFilename: string | null = null;
	let selectedRootBookFilename = '';
	let rootBook = '';
	let localFiles = new Map<string, string>();
	let fileSnapshot = new Map<string, string | undefined>();
	let wroteFiles = false;
	let switchedBook = false;

	updateSyncStep(6, 'in-progress');
	try {
		const rootFilePath = normalizeRootBookPath(
			(await settings.get<string>(SettingKeys.syncBeancountRootFile)) ?? DEFAULT_BEANCOUNT_ROOT_FILE
		);
		previousBookFilename = await settings.get<string>(SettingKeys.bookFilename);
		await settings.set(SettingKeys.syncBeancountRootFile, rootFilePath);
		const remoteFiles = await sync.readLedgerFiles(rootFilePath);
		localFiles = mapRemoteFilesToLocalPaths(normalizeRemotePath(rootFilePath), remoteFiles);
		localFiles = rewriteIncludesToLocalPaths(normalizeRemotePath(rootFilePath), localFiles);
		selectedRootBookFilename = basename(rootFilePath);
		rootBook = localFiles.get(selectedRootBookFilename) ?? '';
		if (!rootBook) throw new Error('Downloaded root book is missing');
		if (rootBook.trim().length === 0) throw new Error('Downloaded root book is empty');
		ensureSafeLocalLedgerFiles(localFiles);
		fileSnapshot = await snapshotExistingFiles([...localFiles.keys()]);
		await ensureCashierFileExists();
		await persistLedgerFiles(localFiles);
		wroteFiles = true;
		updateSyncStep(6, 'completed');
	} catch (error) {
		lastDiagnostics = { ...lastDiagnostics, parseResult: 'error' };
		updateSyncStep(6, 'error');
		throw error;
	}

	updateSyncStep(7, 'in-progress');
	try {
		await settings.set(SettingKeys.bookFilename, selectedRootBookFilename);
		switchedBook = true;
		updateSyncStep(7, 'completed');
	} catch (error) {
		lastDiagnostics = { ...lastDiagnostics, parseResult: 'error' };
		updateSyncStep(7, 'error');
		throw error;
	}

	updateSyncStep(8, 'in-progress');
	try {
		await fullLedgerService.deleteCache();
		await fullLedgerService.invalidate();
		const errors = await fullLedgerService.getErrors();
		lastDiagnostics = {
			...lastDiagnostics,
			ledgerFilesCount: localFiles.size,
			selectedRootBookFilename,
			rootBookSize: rootBook.length,
			parseResult: errors.length > 0 ? 'error' : 'ok',
			parseErrorCount: errors.length,
			parseErrors: describeParseErrors(errors)
		};
		if (errors.length > 0) {
			lastDiagnostics = { ...lastDiagnostics, parseResult: 'error' };
			throw new Error(
				`Full ledger parsed with ${errors.length} errors for ${selectedRootBookFilename}`
			);
		}
		updateSyncStep(8, 'completed');
	} catch (error) {
		if (switchedBook) {
			await settings.set(SettingKeys.bookFilename, previousBookFilename);
		}
		if (wroteFiles) {
			await restoreFiles(fileSnapshot);
		}
		try {
			await fullLedgerService.deleteCache();
			await fullLedgerService.invalidate();
		} catch {
			// Best-effort recovery so the app doesn't stay on the failed ledger state.
		}
		lastDiagnostics = {
			...lastDiagnostics,
			ledgerFilesCount: localFiles.size || undefined,
			selectedRootBookFilename: selectedRootBookFilename || undefined,
			rootBookSize: rootBook.length || undefined,
			parseResult: 'error',
			lastError: describeError(error)
		};
		updateSyncStep(8, 'error');
		throw error;
	}

	Notifier.success('Ledger files downloaded to OPFS');
	return Array.from(localFiles.keys());
}

function getLastDiagnostics() {
	return lastDiagnostics;
}

const __test__ = {
	normalizeRemotePath,
	normalizeRootBookPath,
	parseIncludes,
	resolveRemoteInclude,
	mapRemoteFilesToLocalPaths,
	rewriteIncludesToLocalPaths
};

export { CashierSyncBeancount, type SyncSteps, synchronize, getLastDiagnostics, __test__ };
