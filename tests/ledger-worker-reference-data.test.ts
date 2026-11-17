import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import init, { Ledger } from '@rustledger/wasm';
import type {
	WorkerRequest,
	WorkerRequestPayload,
	WorkerResponse
} from '#lib/workers/ledger.worker';

// Only adapt WASM initialization and browser storage; parsing, BQL and cache bytes are real.
vi.mock('@rustledger/wasm', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@rustledger/wasm')>();
	return {
		...actual,
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
const sourceRequest = { mainFileName: 'cashier.bean', userBookFilename: 'main.bean' };
const payeeBql =
	'SELECT DISTINCT COALESCE(payee, narration) as payee FROM transactions ORDER BY payee';
const book = `2000-01-01 open Assets:Unused GBP, CHF
2000-01-01 open Assets:Declared USD, EUR
2000-01-01 open Assets:Cash
2000-01-01 open Assets:Closed CAD
2000-01-01 open Expenses:Food
2002-01-01 close Assets:Closed
include "books/transactions.bean"
`;
const transaction = (
	payee: string,
	currency: string,
	account = 'Assets:Cash',
	date = '2026-01-01'
) =>
	`${date} * "${payee}" "Purchase"
  Expenses:Food 10 ${currency}
  ${account} -10 ${currency}
`;
const serverTransactions =
	transaction('Closed Shop', 'CAD', 'Assets:Closed', '2001-01-01') +
	`2001-01-02 * "Closed Shop" "Reversal"
  Expenses:Food -10 CAD
  Assets:Closed 10 CAD
` +
	transaction('Server Shop', 'RUB') +
	transaction('Declared Shop', 'USD', 'Assets:Declared');
const expectedAccounts = [
	{ name: 'Assets:Cash', currencies: ['LONGCOIN', 'RUB'] },
	{ name: 'Assets:Declared', currencies: ['USD', 'EUR'] },
	{ name: 'Assets:Unused', currencies: ['GBP', 'CHF'] },
	{ name: 'Expenses:Food', currencies: ['CAD', 'LONGCOIN', 'RUB', 'USD'] }
];
const encoder = new TextEncoder();
let files: Map<string, Uint8Array>;
let sources: Map<string, Uint8Array>;
let storageMutations: string[];
let http: ReturnType<typeof vi.fn>;
type WorkerHarness = { send: (payload: WorkerRequestPayload) => Promise<WorkerResponse> };
let active: WorkerHarness | undefined;

function seed(path: string, text: string) {
	const bytes = encoder.encode(text);
	files.set(path, bytes.slice());
	sources.set(path, bytes.slice());
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
				storageMutations.push(path);
				files.set(path, new Uint8Array());
			}
			return {
				kind: 'file',
				async getFile() {
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
							pending = new Uint8Array(data).slice();
						},
						async close() {
							storageMutations.push(path);
							files.set(path, pending);
						},
						async abort() {}
					};
				}
			};
		},
		async removeEntry(name: string) {
			const path = prefix + name;
			if (!files.has(path)) throw new DOMException('Missing', 'NotFoundError');
			storageMutations.push(path);
			files.delete(path);
		},
		async *entries() {
			const names = new Set(
				[...files.keys()]
					.filter((path) => path.startsWith(prefix))
					.map((path) => path.slice(prefix.length).split('/')[0])
			);
			for (const name of names) {
				const nested = [...files.keys()].some((path) => path.startsWith(`${prefix}${name}/`));
				yield [name, nested ? directory(`${prefix}${name}/`) : await this.getFileHandle(name)];
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

async function load(worker: WorkerHarness, useCaching: boolean, type = 'ensure-loaded' as const) {
	expect(await worker.send({ type, ...sourceRequest, useCaching })).toMatchObject({
		type: 'load-done',
		errorCount: 0
	});
}

async function accounts(worker: WorkerHarness) {
	const response = await worker.send({ type: 'get-all-accounts' });
	if (response.type !== 'all-accounts-done') throw new Error(JSON.stringify(response));
	return response.accounts;
}

async function payees(worker: WorkerHarness) {
	const response = await worker.send({ type: 'query', bql: payeeBql });
	if (response.type !== 'query-done') throw new Error(JSON.stringify(response));
	expect(response.errors).toEqual([]);
	expect(response.columns).toEqual(['payee']);
	return response.rows;
}

beforeAll(async () => {
	await init();
});
beforeEach(() => {
	files = new Map();
	sources = new Map();
	storageMutations = [];
	active = undefined;
	http = vi.fn(() => {
		throw new Error('Unexpected HTTP request');
	});
	vi.stubGlobal('fetch', http);
	vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory() } });
	seed('cashier.bean', transaction('Local Cafe', 'LONGCOIN') + transaction('Server Shop', 'RUB'));
	seed('main.bean', book);
	seed('books/transactions.bean', serverTransactions);
	seed(
		'unselected.bean',
		'2000-01-01 open Assets:Unselected JPY\n2000-01-01 open Expenses:Food\n' +
			transaction('Unselected Payee', 'JPY', 'Assets:Unselected')
	);
});
afterEach(async () => {
	try {
		if (active) await active.send({ type: 'reset' });
		expect(http).not.toHaveBeenCalled();
		expect(new Map([...files].filter(([path]) => path.endsWith('.bean')))).toEqual(sources);
		expect(storageMutations.every((path) => path === cacheFile || path === metadataFile)).toBe(
			true
		);
	} finally {
		vi.unstubAllGlobals();
	}
});

for (const useCaching of [false, true]) {
	describe(`real worker reference queries (cache ${useCaching ? 'enabled' : 'disabled'})`, () => {
		it('keeps unused opens and declared currencies, merges posting currencies only into open accounts', async () => {
			const worker = await boot();
			await load(worker, useCaching);
			expect(await accounts(worker)).toEqual(expectedAccounts);
			// Repeated reads neither accumulate duplicate currencies nor change declarations.
			expect(await accounts(worker)).toEqual(expectedAccounts);
		});

		it('uses the exact page payee query over selected book and journal, including narration-only and posting-free entries', async () => {
			seed(
				'cashier.bean',
				new TextDecoder().decode(sources.get('cashier.bean')) +
					'2026-01-02 ! "Narration only"\n' +
					'2026-01-03 * "Posting-free Payee" "No postings"\n'
			);
			const worker = await boot();
			await load(worker, useCaching);
			expect(await payees(worker)).toEqual([
				['Closed Shop'],
				['Declared Shop'],
				['Local Cafe'],
				['Narration only'],
				['Posting-free Payee'],
				['Server Shop']
			]);
		});

		it('honors serialized cold cache mode and refreshes both lists on invalidation and another cold load', async () => {
			const worker = await boot();
			await load(worker, useCaching);
			expect(await worker.send({ type: 'serialize-ledger' })).toMatchObject({
				type: 'serialize-ledger-done',
				bytes: expect.any(Number)
			});
			expect(files.get(cacheFile)!.length).toBeGreaterThan(0);
			expect(files.has(metadataFile)).toBe(true);

			const restore = vi.spyOn(Ledger, 'fromCache');
			const parse = vi.spyOn(Ledger, 'fromFiles');
			const cold = await boot();
			await load(cold, useCaching);
			expect(restore).toHaveBeenCalledTimes(useCaching ? 1 : 0);
			expect(parse).toHaveBeenCalledTimes(useCaching ? 0 : 1);
			expect(await accounts(cold)).toEqual(expectedAccounts);
			expect(await payees(cold)).toEqual([
				['Closed Shop'],
				['Declared Shop'],
				['Local Cafe'],
				['Server Shop']
			]);

			seed('main.bean', book + '2000-01-01 open Assets:New NZD\n');
			seed('books/transactions.bean', transaction('New Shop', 'EUR'));
			seed('cashier.bean', transaction('Remaining Local', 'LONGCOIN'));
			expect(await cold.send({ type: 'invalidate', ...sourceRequest, useCaching })).toMatchObject({
				type: 'load-done',
				errorCount: 0
			});
			const refreshedAccounts = [
				{ name: 'Assets:Cash', currencies: ['EUR', 'LONGCOIN'] },
				{ name: 'Assets:Declared', currencies: ['USD', 'EUR'] },
				{ name: 'Assets:New', currencies: ['NZD'] },
				{ name: 'Assets:Unused', currencies: ['GBP', 'CHF'] },
				{ name: 'Expenses:Food', currencies: ['EUR', 'LONGCOIN'] }
			];
			expect(await accounts(cold)).toEqual(refreshedAccounts);
			expect(await payees(cold)).toEqual([['New Shop'], ['Remaining Local']]);
			expect(files.has(metadataFile)).toBe(useCaching);

			restore.mockClear();
			parse.mockClear();
			const refreshedCold = await boot();
			await load(refreshedCold, useCaching);
			expect(restore).toHaveBeenCalledTimes(useCaching ? 1 : 0);
			expect(parse).toHaveBeenCalledTimes(useCaching ? 0 : 1);
			expect(await accounts(refreshedCold)).toEqual(refreshedAccounts);
			expect(await payees(refreshedCold)).toEqual([['New Shop'], ['Remaining Local']]);
		});
	});
}
