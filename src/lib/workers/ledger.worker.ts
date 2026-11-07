/**
 * Ledger Web Worker.
 *
 * Owns a persistent Ledger WASM instance across messages so that file I/O and
 * CPU-intensive parsing/querying never block the main thread.
 *
 * No SvelteKit/$lib imports — only bare npm packages and relative paths.
 */

import wasmUrl from '@rustledger/wasm/rustledger_wasm_bg.wasm?url';
import { LEDGER_CACHE_FILE } from '../constants';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let wasmModule: typeof import('@rustledger/wasm') | null = null;
let ledger: import('@rustledger/wasm').Ledger | null = null;
const CACHE_METADATA_FILE = `${LEDGER_CACHE_FILE}.json`;
const CACHE_FORMAT = 1;
type SourceComposition = {
	mainFileName: string;
	userBookFilename?: string;
	fileMap: Record<string, string>;
	sourceHash: string;
};
let loadedComposition: SourceComposition | null = null;

// ---------------------------------------------------------------------------
// WASM init
// ---------------------------------------------------------------------------

async function initWasm() {
	if (wasmModule) return;
	const mod = await import('@rustledger/wasm');
	await mod.default({ module_or_path: wasmUrl });
	wasmModule = mod;
}

// ---------------------------------------------------------------------------
// OPFS helpers
// ---------------------------------------------------------------------------

async function opfsGetHandle(
	filename: string,
	create = false
): Promise<FileSystemFileHandle | undefined> {
	try {
		const root = await navigator.storage.getDirectory();
		const parts = filename.split('/');
		const name = parts.pop()!;
		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts) {
			dir = await dir.getDirectoryHandle(part, { create });
		}
		return await dir.getFileHandle(name, { create });
	} catch {
		return undefined;
	}
}

async function opfsReadBinary(filename: string): Promise<Uint8Array | undefined> {
	const handle = await opfsGetHandle(filename);
	if (!handle) return undefined;
	const file = await handle.getFile();
	return new Uint8Array(await file.arrayBuffer());
}

async function opfsSaveBinary(filename: string, data: Uint8Array): Promise<void> {
	const handle = await opfsGetHandle(filename, true);
	if (!handle) throw new Error(`Cannot open ${filename} for writing`);
	const stream = await handle.createWritable();
	try {
		await stream.write(data.slice().buffer as ArrayBuffer);
		await stream.close();
	} catch (error) {
		await stream.abort().catch(() => {});
		throw error;
	}
}

async function opfsDeleteFile(filename: string): Promise<void> {
	try {
		const root = await navigator.storage.getDirectory();
		const parts = filename.split('/');
		const name = parts.pop()!;
		let dir: FileSystemDirectoryHandle = root;
		for (const part of parts) {
			dir = await dir.getDirectoryHandle(part);
		}
		await dir.removeEntry(name);
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
	}
}

async function opfsListBeanFiles(): Promise<Array<{ path: string; content: string }>> {
	const root = await navigator.storage.getDirectory();
	const results: Array<{ path: string; content: string }> = [];

	async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		for await (const [name, handle] of (dir as any).entries()) {
			const path = prefix ? `${prefix}/${name}` : name;
			if (handle.kind === 'directory') {
				await walk(handle as FileSystemDirectoryHandle, path);
			} else if (name.endsWith('.bean')) {
				const file = await (handle as FileSystemFileHandle).getFile();
				results.push({ path, content: await file.text() });
			}
		}
	}

	await walk(root, '');
	return results;
}

async function loadFromCacheOrFiles(
	mainFileName: string,
	userBookFilename?: string,
	useCaching = true
): Promise<void> {
	clearLedger();
	const composition = await readComposition(mainFileName, userBookFilename);
	if (useCaching) {
		try {
			const metadataBytes = await opfsReadBinary(CACHE_METADATA_FILE);
			const metadata = metadataBytes && JSON.parse(new TextDecoder().decode(metadataBytes));
			if (metadata?.format === CACHE_FORMAT && metadata.sourceHash === composition.sourceHash) {
				const bytes = await opfsReadBinary(LEDGER_CACHE_FILE);
				if (bytes && metadata.binaryHash === (await fingerprint(bytes))) {
					ledger = wasmModule!.Ledger.fromCache(bytes);
					loadedComposition = composition;
					return;
				}
			}
		} catch {
			// Unreadable, legacy, incompatible or corrupt cache: sources remain authoritative.
		}
	}
	ledger = wasmModule!.Ledger.fromFiles(composition.fileMap, mainFileName);
	loadedComposition = composition;
}

// ---------------------------------------------------------------------------
// Message protocol
// ---------------------------------------------------------------------------

/**
 * All requests include an `id` that is echoed in the matching response so the
 * client can resolve the correct promise.
 */
export type WorkerRequestPayload =
	// --- Persistent-ledger operations ---
	| { type: 'load'; mainFileName: string; userBookFilename?: string }
	| { type: 'ensure-loaded'; mainFileName: string; userBookFilename?: string; useCaching?: boolean }
	| { type: 'invalidate'; mainFileName: string; userBookFilename?: string; useCaching?: boolean }
	| { type: 'query'; bql: string }
	| { type: 'get-directives' }
	| { type: 'get-errors' }
	| { type: 'get-state' }
	| { type: 'reset' }
	/** Serialize the persistent ledger to the OPFS cache file. */
	| { type: 'serialize-ledger' }
	/** Restore the persistent ledger from the OPFS cache file. */
	| { type: 'load-from-cache'; mainFileName: string; userBookFilename?: string }
	/** Free the in-memory ledger and delete the OPFS cache file. */
	| { type: 'delete-cache' }
	/** Return all open accounts (open directives + BQL tx accounts merged). */
	| { type: 'get-all-accounts' }
	/** Return ledger options (e.g. operating_currencies). */
	| { type: 'get-options' };

export type WorkerRequest = { id: number } & WorkerRequestPayload;

export type WorkerResponsePayload =
	| { type: 'load-done'; directiveCount: number; errorCount: number; ms: number }
	| { type: 'query-done'; columns: string[]; rows: unknown[]; errors: unknown[] }
	| { type: 'directives-done'; directives: unknown[] }
	| { type: 'errors-done'; errors: unknown[] }
	| { type: 'state-done'; isLoaded: boolean }
	| { type: 'reset-done' }
	| { type: 'all-accounts-done'; accounts: Array<{ name: string; currencies: string[] }> }
	| { type: 'serialize-ledger-done'; bytes: number; ms: number }
	| { type: 'load-from-cache-done'; directiveCount: number; ms: number }
	| { type: 'delete-cache-done' }
	| { type: 'options-done'; operatingCurrencies: string[] }
	| { type: 'error'; message: string };

export type WorkerResponse = { id: number } & WorkerResponsePayload;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearLedger(): void {
	ledger?.free();
	ledger = null;
	loadedComposition = null;
}

async function fingerprint(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readComposition(
	mainFileName: string,
	userBookFilename?: string
): Promise<SourceComposition> {
	const beanFiles = await opfsListBeanFiles();
	if (beanFiles.length === 0) throw new Error('No .bean files found in OPFS');
	const fileMap: Record<string, string> = Object.create(null);
	for (const { path, content } of beanFiles) {
		fileMap[path] = content;
	}
	if (fileMap[mainFileName] === undefined)
		throw new Error(`Analysis root missing: ${mainFileName}`);
	if (userBookFilename && fileMap[userBookFilename] === undefined) {
		throw new Error(`Selected book missing: ${userBookFilename}`);
	}
	// Inject the user's book include into cashier.bean on-the-fly, without
	// persisting the directive to disk. Only when the book file is actually present.
	if (
		userBookFilename &&
		userBookFilename !== mainFileName &&
		fileMap[mainFileName] !== undefined &&
		fileMap[userBookFilename] !== undefined
	) {
		fileMap[mainFileName] = `include "${userBookFilename}"\n\n${fileMap[mainFileName]}`;
	}
	// Hash the exact parser input, including paths (glob additions/deletions matter),
	// composition rules and parser build. No independent include parser to drift from WASM.
	const sourceHash = await fingerprint(
		new TextEncoder().encode(
			JSON.stringify([
				CACHE_FORMAT,
				wasmModule!.version(),
				wasmUrl,
				mainFileName,
				userBookFilename ?? null,
				Object.keys(fileMap)
					.sort()
					.map((path) => [path, fileMap[path]])
			])
		)
	);
	return { mainFileName, userBookFilename, fileMap, sourceHash };
}

async function loadFromFiles(mainFileName: string, userBookFilename?: string): Promise<void> {
	clearLedger();
	const composition = await readComposition(mainFileName, userBookFilename);
	ledger = wasmModule!.Ledger.fromFiles(composition.fileMap, mainFileName);
	loadedComposition = composition;
}

async function saveCache(): Promise<number> {
	if (!ledger || !loadedComposition)
		throw new Error('Ledger not loaded — call load or ensure-loaded first');
	// Retire acceptance metadata before any fallible serialization/write. Even if
	// the old binary survives, no future worker may activate it without validation.
	await opfsDeleteFile(CACHE_METADATA_FILE);
	const current = await readComposition(
		loadedComposition.mainFileName,
		loadedComposition.userBookFilename
	);
	if (current.sourceHash !== loadedComposition.sourceHash) {
		throw new Error('Analysis sources changed — reload the ledger before serializing');
	}
	const bytes = ledger.serialize();
	const metadata = new TextEncoder().encode(
		JSON.stringify({
			format: CACHE_FORMAT,
			sourceHash: loadedComposition.sourceHash,
			binaryHash: await fingerprint(bytes)
		})
	);
	await opfsSaveBinary(LEDGER_CACHE_FILE, bytes);
	// Publish last: a partial write or interrupted pair is always a cache miss.
	await opfsSaveBinary(CACHE_METADATA_FILE, metadata);
	return bytes.length;
}

// ---------------------------------------------------------------------------
// Message handler — serialized via a queue so async handlers never interleave.
// An async onmessage can be re-entered while awaiting; the queue ensures that
// e.g. a 'query' message never races a concurrent 'invalidate'.
// ---------------------------------------------------------------------------

const _msgQueue: MessageEvent<WorkerRequest>[] = [];
let _processing = false;

async function handleMessage(e: MessageEvent<WorkerRequest>): Promise<void> {
	const { id } = e.data;

	const reply = (data: WorkerResponsePayload) => {
		(self as unknown as Worker).postMessage({ id, ...data } satisfies WorkerResponse);
	};

	try {
		await initWasm();

		switch (e.data.type) {
			case 'load': {
				const t0 = performance.now();
				await loadFromFiles(e.data.mainFileName, e.data.userBookFilename);
				const ms = performance.now() - t0;
				reply({
					type: 'load-done',
					directiveCount: ledger!.getDirectives().length,
					errorCount: ledger!.getErrors().length,
					ms
				});
				break;
			}

			case 'ensure-loaded': {
				if (
					!ledger ||
					loadedComposition?.mainFileName !== e.data.mainFileName ||
					loadedComposition?.userBookFilename !== e.data.userBookFilename
				) {
					const t0 = performance.now();
					await loadFromCacheOrFiles(
						e.data.mainFileName,
						e.data.userBookFilename,
						e.data.useCaching ?? true
					);
					const ms = performance.now() - t0;
					reply({
						type: 'load-done',
						directiveCount: ledger!.getDirectives().length,
						errorCount: ledger!.getErrors().length,
						ms
					});
				} else {
					reply({
						type: 'load-done',
						directiveCount: ledger.getDirectives().length,
						errorCount: ledger.getErrors().length,
						ms: 0
					});
				}
				break;
			}

			case 'invalidate': {
				const t0 = performance.now();
				clearLedger();
				await opfsDeleteFile(CACHE_METADATA_FILE);
				await loadFromFiles(e.data.mainFileName, e.data.userBookFilename);
				if (e.data.useCaching ?? true) await saveCache();
				const ms = performance.now() - t0;
				reply({
					type: 'load-done',
					directiveCount: ledger!.getDirectives().length,
					errorCount: ledger!.getErrors().length,
					ms
				});
				break;
			}

			case 'query': {
				if (!ledger) throw new Error('Ledger not loaded');
				const result = ledger.query(e.data.bql);
				reply({
					type: 'query-done',
					columns: result.columns ?? [],
					rows: result.rows ?? [],
					errors: result.errors ?? []
				});
				break;
			}

			case 'get-directives': {
				reply({
					type: 'directives-done',
					directives: ledger ? ledger.getDirectives() : []
				});
				break;
			}

			case 'get-errors': {
				reply({
					type: 'errors-done',
					errors: ledger ? ledger.getErrors() : []
				});
				break;
			}

			case 'get-state': {
				reply({ type: 'state-done', isLoaded: ledger !== null });
				break;
			}

			case 'reset': {
				clearLedger();
				reply({ type: 'reset-done' });
				break;
			}

			case 'serialize-ledger': {
				if (!ledger) throw new Error('Ledger not loaded — call load or ensure-loaded first');
				const t0 = performance.now();
				const bytes = await saveCache();
				const ms = performance.now() - t0;

				reply({ type: 'serialize-ledger-done', bytes, ms });
				break;
			}

			case 'load-from-cache': {
				const t0 = performance.now();
				await loadFromCacheOrFiles(e.data.mainFileName, e.data.userBookFilename);
				const ms = performance.now() - t0;
				reply({
					type: 'load-from-cache-done',
					directiveCount: ledger!.getDirectives().length,
					ms
				});
				break;
			}

			case 'delete-cache': {
				clearLedger();
				await opfsDeleteFile(CACHE_METADATA_FILE);
				await opfsDeleteFile(LEDGER_CACHE_FILE);
				reply({ type: 'delete-cache-done' });
				break;
			}

			case 'get-all-accounts': {
				if (!ledger) {
					reply({ type: 'all-accounts-done', accounts: [] });
					break;
				}
				const bql =
					'SELECT account, currencies from #accounts where close is null ORDER BY account';
				const result = ledger.query(bql);
				const accountCol = (result.columns ?? []).indexOf('account');
				const currenciesCol = (result.columns ?? []).indexOf('currencies');
				const accounts = ((result.rows ?? []) as any[]).map((row) => ({
					name: accountCol !== -1 ? (row[accountCol] ?? '') : '',
					currencies: currenciesCol !== -1 ? (row[currenciesCol] ?? []) : []
				}));
				reply({ type: 'all-accounts-done', accounts });
				break;
			}

			case 'get-options': {
				const opts = ledger ? ledger.getOptions() : null;
				reply({
					type: 'options-done',
					operatingCurrencies: opts?.operating_currencies ?? []
				});
				break;
			}

			default:
				reply({
					type: 'error',
					message: `Unknown request type: ${(e.data as WorkerRequest).type}`
				});
		}
	} catch (err) {
		if (
			[
				'load',
				'ensure-loaded',
				'invalidate',
				'load-from-cache',
				'serialize-ledger',
				'delete-cache'
			].includes(e.data.type)
		) {
			clearLedger();
		}
		reply({ type: 'error', message: String(err) });
	}
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
	_msgQueue.push(e);
	if (!_processing) {
		_processing = true;
		(async () => {
			while (_msgQueue.length > 0) {
				await handleMessage(_msgQueue.shift()!);
			}
			_processing = false;
		})();
	}
};
