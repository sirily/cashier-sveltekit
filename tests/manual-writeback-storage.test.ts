import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	prepareLocalTransactions,
	reconcileLocalJournalFromPaths
} from '#lib/sync/manual-writeback';
import { readJournal } from '#lib/sync/journal-storage';

const completed =
	'2026-06-01 * "Cafe" "Exact total"\n  Expenses:Food  3 ITEM @@ 10.01 USD\n  Assets:Cash  -10.01 USD';
const identified = completed.replace('\n', '\n    cashier_id: "local-id"\n');
const draft =
	'2026-06-02 ! "Draft" "Leave exactly"\r\n\tcashier_id: "draft-id"\r\n\tExpenses:Food  7.00 USD\r\n\tAssets:Cash\r\n';
const appended =
	'\n2026-06-03 * "New" "Concurrent append"\n  Expenses:Food  2 USD\n  Assets:Cash\n';
const generatedId = '00000000-0000-4000-8000-000000000001';

function createStorage() {
	const files = new Map<string, string>([['cashier.bean', completed + '\n\n' + draft]]);
	const fault = {
		root: undefined as Error | undefined,
		handle: undefined as Error | undefined,
		file: undefined as Error | undefined,
		text: undefined as Error | undefined,
		open: undefined as Error | undefined,
		write: undefined as Error | undefined,
		close: undefined as Error | undefined,
		silent: false,
		reads: 0,
		onRead: (_read: number) => {},
		onOpen: () => {},
		onWrite: () => {}
	};
	const abort = vi.fn(async () => {});
	const write = vi.fn();
	const close = vi.fn();
	const createWritable = vi.fn(async () => {
		if (fault.open) throw fault.open;
		fault.onOpen();
		let staged = '';
		return {
			write: async (data: Uint8Array) => {
				write(data);
				if (fault.write) throw fault.write;
				staged = new TextDecoder().decode(data);
				fault.onWrite();
			},
			close: async () => {
				close();
				if (fault.close) throw fault.close;
				if (!fault.silent) files.set('cashier.bean', staged);
			},
			abort
		};
	});
	const getFileHandle = vi.fn(async (name: string, options?: { create?: boolean }) => {
		if (fault.handle) throw fault.handle;
		if (!files.has(name)) {
			if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');
			files.set(name, '');
		}
		return {
			getFile: async () => {
				if (fault.file) throw fault.file;
				const snapshot = files.get(name)!;
				return {
					text: async () => {
						if (fault.text) throw fault.text;
						fault.onRead(++fault.reads);
						return snapshot;
					}
				};
			},
			createWritable
		};
	});
	const getDirectory = vi.fn(async () => {
		if (fault.root) throw fault.root;
		return { getFileHandle };
	});
	return { files, fault, getDirectory, getFileHandle, createWritable, write, close, abort };
}

let storage: ReturnType<typeof createStorage>;
beforeEach(() => {
	storage = createStorage();
	vi.stubGlobal('navigator', { storage: { getDirectory: storage.getDirectory } });
	vi.spyOn(crypto, 'randomUUID').mockReturnValue(generatedId);
});
afterEach(() => vi.unstubAllGlobals());

async function reconcile() {
	await reconcileLocalJournalFromPaths([], ['server.bean'], {
		accepted: [{ cashierId: 'local-id', rawText: identified }],
		confirmedIds: ['local-id', 'draft-id']
	});
}

describe('strict journal reads', () => {
	test('a genuinely missing journal is empty and never created', async () => {
		storage.files.delete('cashier.bean');
		await expect(prepareLocalTransactions()).resolves.toEqual([]);
		await expect(reconcile()).resolves.toBeUndefined();
		expect(storage.files.has('cashier.bean')).toBe(false);
		expect(storage.getFileHandle.mock.calls.every(([, options]) => !options?.create)).toBe(true);
		expect(storage.createWritable).not.toHaveBeenCalled();
	});

	test.each(['root', 'handle', 'file', 'text'] as const)(
		'%s failure is not treated as an empty journal by either stage',
		async (stage) => {
			const source = storage.files.get('cashier.bean');
			const error = new DOMException(`Failed ${stage}`, 'NotAllowedError');
			storage.fault[stage] = error;
			await expect(prepareLocalTransactions()).rejects.toBe(error);
			await expect(reconcile()).rejects.toBe(error);
			expect(storage.files.get('cashier.bean')).toBe(source);
			expect(storage.createWritable).not.toHaveBeenCalled();
		}
	);

	test('NotFound while acquiring OPFS itself is still an access failure', async () => {
		storage.fault.root = new DOMException('No OPFS root', 'NotFoundError');
		await expect(readJournal()).rejects.toBe(storage.fault.root);
	});

	test('a disappearing file after handle acquisition is not a successful read', async () => {
		storage.fault.file = new DOMException('File disappeared', 'NotFoundError');
		await expect(readJournal()).rejects.toBe(storage.fault.file);
	});
});

describe('durable identity preparation', () => {
	test('returns only stored IDs, preserves exact @@ and draft bytes, and retries without writes', async () => {
		const source = storage.files.get('cashier.bean')!;
		const pending = await prepareLocalTransactions();
		expect(pending).toEqual([
			{
				cashierId: generatedId,
				rawText: completed.replace('\n', `\n    cashier_id: "${generatedId}"\n`)
			}
		]);
		const saved = await readJournal();
		expect(saved).toBe(pending[0].rawText + '\n\n' + draft);
		expect(saved).toContain('@@ 10.01 USD');
		expect(saved).not.toBe(source);
		expect(storage.close).toHaveBeenCalledTimes(1);
		expect(await prepareLocalTransactions()).toEqual(pending);
		expect(await readJournal()).toBe(saved);
		expect(storage.createWritable).toHaveBeenCalledTimes(1);
		expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
	});

	test('an existing identity and all journal bytes stay unchanged on no-op preparation', async () => {
		const source = identified.replaceAll('\n', '\r\n') + '\r\n\r\n' + draft;
		storage.files.set('cashier.bean', source);
		expect(await prepareLocalTransactions()).toEqual([
			{
				cashierId: 'local-id',
				rawText: identified.replaceAll('\n', '\r\n')
			}
		]);
		expect(await readJournal()).toBe(source);
		expect(storage.createWritable).not.toHaveBeenCalled();
		expect(crypto.randomUUID).not.toHaveBeenCalled();
	});

	test('CRLF preparation inserts an ID without changing authored line endings', async () => {
		const source = completed.replaceAll('\n', '\r\n') + '\r\n\r\n' + draft;
		storage.files.set('cashier.bean', source);
		const [pending] = await prepareLocalTransactions();
		expect(await readJournal()).toBe(
			source.replace('\r\n', `\r\n    cashier_id: "${generatedId}"\r\n`)
		);
		expect(pending.rawText).toBe((await readJournal())!.split('\r\n\r\n')[0]);
	});
});

for (const stage of ['preparation', 'reconciliation'] as const) {
	describe(`${stage} storage safety`, () => {
		const run = () => (stage === 'preparation' ? prepareLocalTransactions() : reconcile());
		beforeEach(() => {
			if (stage === 'reconciliation')
				storage.files.set('cashier.bean', identified + '\n\n' + draft);
		});

		test.each(['open', 'write', 'close'] as const)(
			'propagates %s failure and leaves entries recoverable',
			async (fault) => {
				const source = storage.files.get('cashier.bean');
				const error = new Error(`Failed ${fault}`);
				storage.fault[fault] = error;
				await expect(run()).rejects.toBe(error);
				expect(await readJournal()).toBe(source);
				if (fault !== 'open') expect(storage.abort).toHaveBeenCalledOnce();
			}
		);

		test('a silently unchanged save is failure, not a successful batch or cleanup', async () => {
			const source = storage.files.get('cashier.bean');
			storage.fault.silent = true;
			await expect(run()).rejects.toThrow(/verify the saved local journal/);
			expect(await readJournal()).toBe(source);
		});

		test('failed handle acquisition on save cannot silently skip persistence', async () => {
			const source = storage.files.get('cashier.bean');
			const error = new DOMException('Cannot open journal', 'NotAllowedError');
			storage.fault.onRead = (read) => {
				if (read === 1) storage.fault.handle = error;
			};
			await expect(run()).rejects.toBe(error);
			expect(storage.files.get('cashier.bean')).toBe(source);
			expect(storage.write).not.toHaveBeenCalled();
		});

		test.each(['append', 'edit', 'delete'] as const)(
			'rejects an observed mid-read %s without overwriting it',
			async (change) => {
				const source = storage.files.get('cashier.bean')!;
				const concurrent =
					change === 'append' ? source + appended : source.replace('Exact total', 'Edited locally');
				storage.fault.onRead = (read) => {
					if (read !== 1) return;
					if (change === 'delete') storage.files.delete('cashier.bean');
					else storage.files.set('cashier.bean', concurrent);
				};
				await expect(run()).rejects.toThrow();
				expect(storage.files.get('cashier.bean')).toBe(
					change === 'delete' ? undefined : concurrent
				);
				expect(storage.write).not.toHaveBeenCalled();
			}
		);

		test('checks for appends while opening a writer', async () => {
			const concurrent = storage.files.get('cashier.bean')! + appended;
			storage.fault.onOpen = () => storage.files.set('cashier.bean', concurrent);
			await expect(run()).rejects.toThrow(/journal changed/);
			expect(await readJournal()).toBe(concurrent);
			expect(storage.abort).toHaveBeenCalledOnce();
			expect(storage.write).not.toHaveBeenCalled();
		});

		test('aborts a staged replacement when an editor appends before close', async () => {
			const concurrent = storage.files.get('cashier.bean')! + appended;
			storage.fault.onWrite = () => storage.files.set('cashier.bean', concurrent);
			await expect(run()).rejects.toThrow(/journal changed/);
			expect(await readJournal()).toBe(concurrent);
			expect(storage.close).not.toHaveBeenCalled();
			expect(storage.abort).toHaveBeenCalledOnce();
		});

		test('cannot report success when verification read fails', async () => {
			storage.fault.onWrite = () => {
				storage.fault.onRead = (read) => {
					if (read === 3) storage.fault.text = new Error('Verification inaccessible');
				};
			};
			await expect(run()).rejects.toThrow('Verification inaccessible');
		});
	});
}

test('reconciliation durably removes only confirmed completed source and preserves exact draft bytes', async () => {
	storage.files.set('cashier.bean', identified + '\n\n' + draft);
	await reconcile();
	expect(await readJournal()).toBe('\n\n' + draft);
	expect(storage.close).toHaveBeenCalledOnce();
});

test('a concurrent change also prevents returning a stale already-identified batch', async () => {
	storage.files.set('cashier.bean', identified);
	storage.fault.onRead = (read) => {
		if (read === 1) storage.files.set('cashier.bean', identified + appended);
	};
	await expect(prepareLocalTransactions()).rejects.toThrow(/journal changed/);
	expect(await readJournal()).toBe(identified + appended);
	expect(storage.createWritable).not.toHaveBeenCalled();
});
