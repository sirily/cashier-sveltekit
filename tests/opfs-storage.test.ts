import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { OPFSBackend, type StorageBackend } from '#lib/storage';

interface TestDirectory {
	kind: 'directory';
	files: Map<string, { content: string; lastModified: number }>;
	directories: Map<string, TestDirectory>;
	getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<TestDirectory>;
	getFileHandle(
		name: string,
		options?: { create?: boolean }
	): Promise<{
		kind: 'file';
		getFile(): Promise<{ text(): Promise<string>; lastModified: number }>;
		createWritable(): Promise<{
			write(data: Uint8Array): Promise<void>;
			close(): Promise<void>;
		}>;
	}>;
	entries(): AsyncGenerator<readonly [string, { kind: 'file' | 'directory' }]>;
}

function createDirectory(): TestDirectory {
	const files = new Map<string, { content: string; lastModified: number }>();
	const directories = new Map<string, TestDirectory>();
	return {
		files,
		directories,
		kind: 'directory' as const,
		async getDirectoryHandle(name: string, { create = false } = {}) {
			if (!directories.has(name)) {
				if (!create) throw new DOMException('Missing directory', 'NotFoundError');
				directories.set(name, createDirectory());
			}
			return directories.get(name)!;
		},
		async getFileHandle(name: string, { create = false } = {}) {
			if (!files.has(name)) {
				if (!create) throw new DOMException('Missing file', 'NotFoundError');
				files.set(name, { content: '', lastModified: 1 });
			}
			return {
				kind: 'file' as const,
				async getFile() {
					const { content, lastModified } = files.get(name)!;
					return { text: async () => content, lastModified };
				},
				async createWritable() {
					let content = '';
					return {
						async write(data: Uint8Array) {
							content = new TextDecoder().decode(data);
						},
						async close() {
							files.set(name, { content, lastModified: files.get(name)!.lastModified + 1 });
						}
					};
				}
			};
		},
		async *entries() {
			for (const name of files.keys()) yield [name, { kind: 'file' }] as const;
			for (const [name, directory] of directories) yield [name, directory] as const;
		}
	};
}

let root: ReturnType<typeof createDirectory>;
let storage: StorageBackend;

beforeEach(() => {
	root = createDirectory();
	root.files.set('cashier.bean', { content: '; local journal\n', lastModified: 42 });
	root.files.set('main.bean', { content: 'include "accounts.bean"\n', lastModified: 17 });
	vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
	storage = new OPFSBackend();
});

afterEach(() => vi.unstubAllGlobals());

test('reads and edits the journal through the public backend while preserving the book', async () => {
	const book = await storage.readFile('main.bean');
	const journal = '2026-11-03 * "Café" "Lunch"\n  cashier_id: "local-1"\n';
	await storage.writeFile('cashier.bean', journal);

	const reopened: StorageBackend = new OPFSBackend();
	await expect(reopened.readFile('cashier.bean')).resolves.toBe(journal);
	await expect(reopened.lastModified('cashier.bean')).resolves.toBe(43);
	await expect(reopened.readFile('main.bean')).resolves.toBe(book);
	await expect(reopened.lastModified('main.bean')).resolves.toBe(17);
});

test('lists root files and reads a selected nested source without changing existing data', async () => {
	const books = await root.getDirectoryHandle('books', { create: true });
	books.files.set('personal.bean', { content: '; selected book\n', lastModified: 12 });

	await expect(storage.listFiles()).resolves.toEqual(['cashier.bean', 'main.bean']);
	await expect(storage.readFile('books/personal.bean')).resolves.toBe('; selected book\n');
	await expect(storage.lastModified('books/personal.bean')).resolves.toBe(12);
	await expect(storage.readFile('cashier.bean')).resolves.toBe('; local journal\n');
});

test('creates and reopens nested text files alongside the existing journal and book', async () => {
	await storage.writeFile('notes/finance/review.txt', 'Review € and ₽ balances\n');
	const reopened = new OPFSBackend();
	await expect(reopened.readFile('notes/finance/review.txt')).resolves.toBe(
		'Review € and ₽ balances\n'
	);
	await expect(reopened.readFile('cashier.bean')).resolves.toBe('; local journal\n');
	await expect(reopened.readFile('main.bean')).resolves.toBe('include "accounts.bean"\n');
});

test('missing file lookups leave the existing directory contents unchanged', async () => {
	await expect(storage.readFile('missing.bean')).resolves.toBeUndefined();
	await expect(storage.lastModified('absent/missing.bean')).resolves.toBeUndefined();
	await expect(storage.listFiles()).resolves.toEqual(['cashier.bean', 'main.bean']);
	expect(root.directories.size).toBe(0);
});
