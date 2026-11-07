import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import init, { Ledger } from '@rustledger/wasm';
import type {
	WorkerRequest,
	WorkerRequestPayload,
	WorkerResponse
} from '#lib/workers/ledger.worker';

const parser = vi.hoisted(() => ({ version: undefined as string | undefined }));
// Only adapt initialization to Node. Parsing, cache serialization/restoration and BQL are real WASM.
vi.mock('@rustledger/wasm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@rustledger/wasm')>();
	return {
		...actual,
		version: () => parser.version ?? actual.version(),
		default: () =>
			actual.default({
				module_or_path: readFileSync(
					new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
				)
			})
	};
});

const cacheFile = 'ledger-cache.bin';
const metadataFile = `${cacheFile}.json`;
const accounts = `option "operating_currency" "USD"
2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2000-01-01 open Income:Salary
`;
const entry = (amount: number, description = 'Server expense') => `2026-10-01 * "${description}"
  Expenses:Food ${amount} RUB
  Assets:Cash -${amount} RUB
`;
const draft = `2026-10-02 ! "Local unfinished"
  Expenses:Food
  Assets:Cash
`;
const realError = `2026-10-03 ! "Remaining server error"
  Expenses:Food
  Assets:Cash
`;
const encoder = new TextEncoder();
let files: Map<string, Uint8Array>;
let fail: { operation?: 'write' | 'close' | 'delete' | 'read'; path?: string };
type WorkerHarness = { send: (payload: WorkerRequestPayload) => Promise<WorkerResponse> };
let active: WorkerHarness | undefined;

function seed(path: string, text: string) {
	files.set(path, encoder.encode(text));
}
function text(path: string) {
	return new TextDecoder().decode(files.get(path));
}
function storageError(operation: string, path: string) {
	if (fail.operation === operation && (!fail.path || fail.path === path))
		throw new Error(`OPFS ${operation} denied: ${path}`);
}
function directory(prefix = ''): any {
	return {
		kind: 'directory',
		async getDirectoryHandle(name: string) {
			return directory(`${prefix}${name}/`);
		},
		async getFileHandle(name: string, options?: { create?: boolean }) {
			const path = prefix + name;
			if (!files.has(path)) {
				if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
				files.set(path, new Uint8Array());
			}
			return {
				kind: 'file',
				async getFile() {
					storageError('read', path);
					const bytes = files.get(path)!.slice();
					return {
						text: async () => new TextDecoder().decode(bytes),
						arrayBuffer: async () => bytes.buffer
					};
				},
				async createWritable() {
					let pending: Uint8Array;
					return {
						async write(data: ArrayBuffer) {
							storageError('write', path);
							pending = new Uint8Array(data).slice();
						},
						async close() {
							storageError('close', path);
							files.set(path, pending);
						},
						async abort() {}
					};
				}
			};
		},
		async removeEntry(name: string) {
			const path = prefix + name;
			storageError('delete', path);
			if (!files.delete(path)) throw new DOMException('Missing', 'NotFoundError');
		},
		async *entries() {
			const names = new Set(
				[...files.keys()]
					.filter((path) => path.startsWith(prefix))
					.map((path) => path.slice(prefix.length).split('/')[0])
			);
			for (const name of names) {
				const isDirectory = [...files.keys()].some((path) => path.startsWith(`${prefix}${name}/`));
				yield [name, isDirectory ? directory(`${prefix}${name}/`) : await this.getFileHandle(name)];
			}
		}
	};
}

async function boot(): Promise<WorkerHarness> {
	if (active) await active.send({ type: 'reset' });
	vi.resetModules();
	let nextId = 0;
	const pending = new Map<number, (response: WorkerResponse) => void>();
	const scope = {
		onmessage: undefined as ((event: MessageEvent<WorkerRequest>) => void) | undefined,
		postMessage(response: WorkerResponse) {
			pending.get(response.id)!(response);
			pending.delete(response.id);
		}
	};
	vi.stubGlobal('self', scope);
	await import('#lib/workers/ledger.worker');
	const send = (payload: WorkerRequestPayload): Promise<WorkerResponse> =>
		new Promise((resolve) => {
			const id = nextId++;
			pending.set(id, resolve);
			scope.onmessage!({ data: { id, ...payload } } as MessageEvent<WorkerRequest>);
		});
	active = { send };
	return active;
}
const sourceRequest = { mainFileName: 'cashier.bean', userBookFilename: 'main.bean' };
async function load(
	worker: Awaited<ReturnType<typeof boot>>,
	type: 'load' | 'ensure-loaded' | 'invalidate' = 'ensure-loaded'
) {
	const response = await worker.send({ type, ...sourceRequest });
	expect(response.type).toBe('load-done');
}
async function rows(worker: Awaited<ReturnType<typeof boot>>) {
	const result = await worker.send({
		type: 'query',
		bql: 'SELECT number, currency, description WHERE account = "Expenses:Food" ORDER BY date'
	});
	expect(result.type).toBe('query-done');
	if (result.type !== 'query-done') throw new Error(JSON.stringify(result));
	expect(result.errors).toEqual([]);
	return result.rows;
}
async function cache(worker: Awaited<ReturnType<typeof boot>>) {
	await load(worker, 'load');
	expect(await worker.send({ type: 'serialize-ledger' })).toMatchObject({
		type: 'serialize-ledger-done'
	});
}

beforeAll(async () => {
	await init();
});
beforeEach(() => {
	files = new Map();
	fail = {};
	active = undefined;
	parser.version = undefined;
	vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory() } });
	seed('cashier.bean', draft);
	seed('main.bean', `${accounts}include "books/included.bean"\n`);
	seed('books/included.bean', entry(10));
});
afterEach(async () => {
	if (active) await active.send({ type: 'reset' });
	vi.unstubAllGlobals();
});

describe('actual ledger worker and WASM cache acceptance', () => {
	it('does not resurrect drafts in the QA order: cached drafts, OPFS edit, journal clear, cold reload', async () => {
		const worker = await boot();
		await cache(worker);
		seed('books/included.bean', entry(20) + realError);
		seed('cashier.bean', ''); // Durable Delete All result; the UI notification is section 11.
		const before = new Map(files);
		const cold = await boot();
		await load(cold);
		expect(await rows(cold)).toEqual([
			['20', 'RUB', 'Server expense'],
			[null, null, 'Remaining server error']
		]);
		const errors = await cold.send({ type: 'get-errors' });
		expect(errors).toMatchObject({
			type: 'errors-done',
			errors: expect.arrayContaining([
				expect.objectContaining({
					message: expect.stringContaining('2 postings with missing amounts')
				})
			])
		});
		for (const [path, bytes] of before)
			if (path.endsWith('.bean')) expect(files.get(path)).toEqual(bytes);
	});

	it.each(['cashier.bean', 'main.bean', 'books/included.bean'])(
		'rejects a same-length edit in %s before fromCache',
		async (path) => {
			seed('cashier.bean', entry(10, 'Overlay'));
			if (path === 'main.bean')
				seed(path, `${accounts}${entry(10, 'Root')}include "books/included.bean"\n`);
			const worker = await boot();
			await cache(worker);
			const old = text(path);
			const changed = old.replaceAll('10 RUB', '90 RUB');
			expect(changed.length).toBe(old.length);
			expect(changed).not.toBe(old);
			seed(path, changed);
			const restore = vi.spyOn(Ledger, 'fromCache');
			const cold = await boot();
			await load(cold);
			expect(restore).not.toHaveBeenCalled();
			expect(await rows(cold)).toContainEqual([
				'90',
				'RUB',
				path === 'main.bean' ? 'Root' : path === 'cashier.bean' ? 'Overlay' : 'Server expense'
			]);
		}
	);

	it('retains the matching-cache fast path and raw WASM binary format', async () => {
		const worker = await boot();
		await cache(worker);
		const restored = Ledger.fromCache(files.get(cacheFile)!);
		restored.free();
		const restore = vi.spyOn(Ledger, 'fromCache');
		const parse = vi.spyOn(Ledger, 'fromFiles');
		const cold = await boot();
		await load(cold);
		expect(restore).toHaveBeenCalledTimes(1);
		expect(parse).not.toHaveBeenCalled();
		expect(await rows(cold)).toContainEqual(['10', 'RUB', 'Server expense']);
	});

	it.each([
		'missing',
		'corrupt-binary',
		'legacy',
		'corrupt-metadata',
		'missing-metadata',
		'parser-identity',
		'wrong-binary'
	])('falls back to current sources for %s cache', async (kind) => {
		const worker = await boot();
		await cache(worker);
		if (kind === 'missing') {
			files.delete(cacheFile);
			files.delete(metadataFile);
		}
		if (kind === 'corrupt-binary') files.set(cacheFile, encoder.encode('not a cache'));
		if (kind === 'legacy' || kind === 'missing-metadata') files.delete(metadataFile);
		if (kind === 'corrupt-metadata') seed(metadataFile, '{broken');
		if (kind === 'parser-identity') {
			parser.version = 'future-parser';
		}
		if (kind === 'wrong-binary') {
			const other = Ledger.fromFiles({ 'other.bean': accounts + entry(99) }, 'other.bean');
			files.set(cacheFile, other.serialize());
			other.free();
		}
		const parse = vi.spyOn(Ledger, 'fromFiles');
		const cold = await boot();
		await load(cold);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(await rows(cold)).toContainEqual(['10', 'RUB', 'Server expense']);
	});

	it('falls back when WASM rejects binary bytes even with matching envelope checksums', async () => {
		const worker = await boot();
		await cache(worker);
		const bytes = encoder.encode('invalid WASM cache');
		files.set(cacheFile, bytes);
		const metadata = JSON.parse(text(metadataFile));
		metadata.binaryHash = Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(byte) => byte.toString(16).padStart(2, '0')
		).join('');
		seed(metadataFile, JSON.stringify(metadata));
		const restore = vi.spyOn(Ledger, 'fromCache');
		const cold = await boot();
		await load(cold);
		expect(restore).toHaveBeenCalledTimes(1);
		expect(await rows(cold)).toContainEqual(['10', 'RUB', 'Server expense']);
	});

	it('detects newly reachable wildcard includes without rewriting overlay sources', async () => {
		seed('main.bean', `${accounts}include "books/*.bean"\n`);
		const worker = await boot();
		await cache(worker);
		seed('books/new.bean', entry(50, 'New glob entry'));
		const cold = await boot();
		await load(cold);
		expect(await rows(cold)).toContainEqual(['50', 'RUB', 'New glob entry']);
		expect(text('cashier.bean')).toBe(draft);
	});

	it('a readable old binary cannot turn missing sources into a successful empty book', async () => {
		const worker = await boot();
		await cache(worker);
		for (const path of files.keys()) if (path.endsWith('.bean')) files.delete(path);
		const cold = await boot();
		expect(await cold.send({ type: 'ensure-loaded', ...sourceRequest })).toMatchObject({
			type: 'error',
			message: expect.stringContaining('No .bean files')
		});
		expect(await cold.send({ type: 'get-state' })).toMatchObject({ isLoaded: false });
	});

	it('rejects deleted/renamed include paths and preserves missing-include diagnostics', async () => {
		const worker = await boot();
		await cache(worker);
		files.set('books/renamed.bean', files.get('books/included.bean')!);
		files.delete('books/included.bean');
		const restore = vi.spyOn(Ledger, 'fromCache');
		const cold = await boot();
		await load(cold);
		expect(restore).not.toHaveBeenCalled();
		expect(await rows(cold)).not.toContainEqual(['10', 'RUB', 'Server expense']);
		const errors = await cold.send({ type: 'get-errors' });
		expect(JSON.stringify(errors)).toMatch(/included.bean/);
	});

	it('does not accept a cached root when the selected book changes or disappears', async () => {
		const worker = await boot();
		await cache(worker);
		seed('other.bean', accounts + entry(30));
		const cold = await boot();
		expect(
			await cold.send({
				type: 'ensure-loaded',
				mainFileName: 'cashier.bean',
				userBookFilename: 'other.bean'
			})
		).toMatchObject({ type: 'load-done' });
		expect(await rows(cold)).toContainEqual(['30', 'RUB', 'Server expense']);
		files.delete('other.bean');
		const missing = await boot();
		expect(
			await missing.send({
				type: 'ensure-loaded',
				mainFileName: 'cashier.bean',
				userBookFilename: 'other.bean'
			})
		).toMatchObject({ type: 'error', message: expect.stringContaining('other.bean') });
		expect(await missing.send({ type: 'get-state' })).toMatchObject({ isLoaded: false });
	});

	it('validates explicit cache restore and serialization of a stale warm ledger too', async () => {
		const worker = await boot();
		await cache(worker);
		seed('books/included.bean', entry(80));
		expect(await worker.send({ type: 'serialize-ledger' })).toMatchObject({ type: 'error' });
		const cold = await boot();
		expect(await cold.send({ type: 'load-from-cache', ...sourceRequest })).toMatchObject({
			type: 'load-from-cache-done'
		});
		expect(await rows(cold)).toContainEqual(['80', 'RUB', 'Server expense']);
	});

	it.each(['write', 'close'] as const)(
		'retires old cache metadata before a failed binary %s and reports unavailable state',
		async (operation) => {
			const worker = await boot();
			await cache(worker);
			const oldBinary = files.get(cacheFile)!.slice();
			seed('cashier.bean', '');
			seed('books/included.bean', entry(60));
			fail = { operation, path: cacheFile };
			expect(await worker.send({ type: 'invalidate', ...sourceRequest })).toMatchObject({
				type: 'error',
				message: expect.stringContaining('denied')
			});
			expect(await worker.send({ type: 'get-state' })).toMatchObject({ isLoaded: false });
			expect(await worker.send({ type: 'query', bql: 'SELECT number' })).toMatchObject({
				type: 'error'
			});
			expect(files.get(cacheFile)).toEqual(oldBinary);
			expect(files.has(metadataFile)).toBe(false);
			fail = {};
			const restore = vi.spyOn(Ledger, 'fromCache');
			const cold = await boot();
			await load(cold);
			expect(restore).not.toHaveBeenCalled();
			expect(await rows(cold)).toEqual([['60', 'RUB', 'Server expense']]);
		}
	);

	it('does not publish metadata when the metadata commit fails, and propagates deletion failures', async () => {
		const worker = await boot();
		await cache(worker);
		fail = { operation: 'delete', path: metadataFile };
		expect(await worker.send({ type: 'invalidate', ...sourceRequest })).toMatchObject({
			type: 'error',
			message: expect.stringContaining('delete denied')
		});
		expect(await worker.send({ type: 'get-state' })).toMatchObject({ isLoaded: false });
		fail = { operation: 'close', path: metadataFile };
		seed('cashier.bean', '');
		expect(await worker.send({ type: 'invalidate', ...sourceRequest })).toMatchObject({
			type: 'error'
		});
		fail = {};
		const cold = await boot();
		await load(cold);
		expect(await rows(cold)).toEqual([['10', 'RUB', 'Server expense']]);
	});

	it('warm invalidation retains the overlay and original currencies through valid-invalid-valid recovery', async () => {
		seed('cashier.bean', entry(5, 'Pending overlay'));
		const worker = await boot();
		await cache(worker);
		seed('books/included.bean', entry(20) + realError);
		await load(worker, 'invalidate');
		expect(await rows(worker)).toEqual([
			['20', 'RUB', 'Server expense'],
			['5', 'RUB', 'Pending overlay'],
			[null, null, 'Remaining server error']
		]);
		expect(JSON.stringify(await worker.send({ type: 'get-errors' }))).toContain(
			'Remaining server error'
		);
		seed('books/included.bean', entry(30));
		await load(worker, 'invalidate');
		expect(await rows(worker)).toEqual([
			['30', 'RUB', 'Server expense'],
			['5', 'RUB', 'Pending overlay']
		]);
		expect(await worker.send({ type: 'get-errors' })).toMatchObject({ errors: [] });
		const cold = await boot();
		await load(cold);
		expect(await rows(cold)).toEqual([
			['30', 'RUB', 'Server expense'],
			['5', 'RUB', 'Pending overlay']
		]);
	});

	it('binds the selected root identity in a warm worker as well as a cold worker', async () => {
		const worker = await boot();
		await cache(worker);
		seed('other.bean', accounts + entry(40));
		expect(
			await worker.send({
				type: 'ensure-loaded',
				mainFileName: 'cashier.bean',
				userBookFilename: 'other.bean'
			})
		).toMatchObject({ type: 'load-done' });
		expect(await rows(worker)).toContainEqual(['40', 'RUB', 'Server expense']);
	});

	it.each([true, false])(
		'does not load obsolete cache after losing the root (cache %s)',
		async (useCaching) => {
			const worker = await boot();
			await cache(worker);
			files.delete('cashier.bean');
			const cold = await boot();
			expect(
				await cold.send({ type: 'ensure-loaded', ...sourceRequest, useCaching })
			).toMatchObject({ type: 'error', message: expect.stringContaining('cashier.bean') });
			expect(await cold.send({ type: 'get-state' })).toMatchObject({ isLoaded: false });
		}
	);

	it('retires acceptance metadata even when invalidation has caching disabled', async () => {
		const worker = await boot();
		await cache(worker);
		seed('cashier.bean', '');
		expect(
			await worker.send({ type: 'invalidate', ...sourceRequest, useCaching: false })
		).toMatchObject({ type: 'load-done' });
		expect(files.has(metadataFile)).toBe(false);
		const cold = await boot();
		await load(cold);
		expect(await rows(cold)).toEqual([['10', 'RUB', 'Server expense']]);
	});

	it('a failed source read clears warm state and cannot hide behind the old cache', async () => {
		const worker = await boot();
		await cache(worker);
		fail = { operation: 'read', path: 'books/included.bean' };
		expect(await worker.send({ type: 'invalidate', ...sourceRequest })).toMatchObject({
			type: 'error'
		});
		expect(await worker.send({ type: 'get-state' })).toMatchObject({ isLoaded: false });
		expect(await worker.send({ type: 'ensure-loaded', ...sourceRequest })).toMatchObject({
			type: 'error'
		});
	});
});
