import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import initWasm, { Ledger } from '@rustledger/wasm';

const mockState = vi.hoisted(() => {
	const settingsStore = new Map<string, unknown>();
	const opfsFiles = new Map<string, string>();
	return {
		settingsStore,
		opfsFiles,
		deleteCache: vi.fn(async () => {}),
		invalidate: vi.fn(async () => {}),
		getErrors: vi.fn<() => Promise<unknown[]>>(async () => []),
		parseErrors: [] as unknown[],
		confirmationRows: [] as unknown[][],
		queryErrors: [] as unknown[],
		readFailure: undefined as string | undefined,
		writeFailure: undefined as string | undefined,
		openFailure: undefined as string | undefined,
		recoveryWriteFailure: undefined as string | undefined,
		deleteFailure: undefined as string | undefined,
		writeAttempts: [] as string[],
		onRead: vi.fn<(path: string) => Promise<void>>(async () => {}),
		onWrite: vi.fn<(path: string, content: string) => Promise<void>>(async () => {}),
		onClose: vi.fn<(path: string) => Promise<void>>(async () => {}),
		onAbort: vi.fn<(path: string) => Promise<void>>(async () => {}),
		createdLedgers: [] as Array<{ files: Record<string, string>; entryPoint: string }>,
		notifier: {
			init: vi.fn(),
			success: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			warning: vi.fn()
		},
		pushTransactions: vi
			.fn<(...args: unknown[]) => Promise<unknown>>()
			.mockRejectedValue(new Error('Push failed'))
	};
});

vi.mock('#lib/utils/notifier', () => ({
	default: mockState.notifier
}));

vi.mock('#lib/settings', () => ({
	SettingKeys: {
		syncServerUrl: 'syncServerUrl',
		syncApiToken: 'syncApiToken',
		syncBeancountRootFile: 'syncBeancountRootFile',
		bookFilename: 'userBookFilename',
		rootInvestmentAccount: 'aa.rootAccount',
		currency: 'currency'
	},
	settings: {
		get: vi.fn(async (key: string) =>
			mockState.settingsStore.has(key) ? mockState.settingsStore.get(key) : null
		),
		set: vi.fn(async (key: string, value: unknown) => {
			mockState.settingsStore.set(key, value);
		})
	}
}));

vi.mock('#lib/utils/opfslib', () => ({
	readFile: vi.fn(async (path: string) => mockState.opfsFiles.get(path)),
	saveFile: vi.fn(async (path: string, content: string) => {
		mockState.opfsFiles.set(path, content);
	}),
	fileExists: vi.fn(async (path: string) => mockState.opfsFiles.has(path)),
	deleteFile: vi.fn(async (path: string) => {
		mockState.opfsFiles.delete(path);
		return true;
	}),
	listFileTree: vi.fn(async () => {
		return Array.from(mockState.opfsFiles.keys()).map((path) => ({
			path,
			name: path.split('/').pop() ?? path,
			kind: 'file'
		}));
	})
}));

vi.mock('#lib/services/ledgerWorkerClient', () => ({
	default: {
		deleteCache: mockState.deleteCache,
		invalidate: mockState.invalidate,
		getErrors: mockState.getErrors
	}
}));

vi.mock('#lib/services/rustledger', () => ({
	ensureInitialized: vi.fn(async () => {}),
	createLedger: vi.fn((files: Record<string, string>, entryPoint: string) => {
		mockState.createdLedgers.push({ files, entryPoint });
		return {
			getErrors: () => mockState.parseErrors,
			getDirectives: () => [],
			query: vi.fn(() => ({
				columns: ['cashier_id'],
				rows: mockState.confirmationRows,
				errors: mockState.queryErrors
			})),
			free: vi.fn()
		};
	})
}));

vi.mock('#lib/sync/manual-writeback', async () => {
	const actual = await vi.importActual<typeof import('#lib/sync/manual-writeback')>(
		'#lib/sync/manual-writeback'
	);
	return {
		...actual,
		pushTransactions: mockState.pushTransactions
	};
});

import * as opfs from '#lib/utils/opfslib';
import * as manualWriteback from '#lib/sync/manual-writeback';
import type { PendingTransaction } from '#lib/sync/manual-writeback';
import * as rustledger from '#lib/services/rustledger';
import { SettingKeys, settings } from '#lib/settings';
import { get } from 'svelte/store';
import { syncProgress } from '#lib/stores/syncProgressStore';
import {
	CashierSyncBeancount,
	__test__,
	getLastDiagnostics,
	synchronize
} from '#lib/sync/sync-beancount';

const createMockLedger = vi.mocked(rustledger.createLedger).getMockImplementation()!;

describe('Beancount sync path helpers', () => {
	test('normalizes infrastructure paths and rejects traversal above root', () => {
		expect(__test__.normalizeRemotePath('/workspace//books/./main.bean')).toBe(
			'/workspace/books/main.bean'
		);
		expect(__test__.normalizeRemotePath('/workspace/books/../main.bean')).toBe(
			'/workspace/main.bean'
		);
		expect(() => __test__.normalizeRemotePath('../../etc/passwd')).toThrow(
			'Invalid infrastructure path'
		);
	});

	test('normalizes legacy workspace root book defaults to workspace-relative paths', () => {
		expect(__test__.normalizeRootBookPath('/workspace/main.bean')).toBe('main.bean');
		expect(__test__.normalizeRootBookPath('/workspace/books/main.bean')).toBe('books/main.bean');
		expect(__test__.normalizeRootBookPath('books/main.bean')).toBe('books/main.bean');
		expect(__test__.normalizeRootBookPath('')).toBe('main.bean');
	});

	test('parses include directives and ignores commented lines', () => {
		const content = [
			'option "title" "Cashier"',
			'include "accounts.bean"',
			'  include "prices/2026.bean"',
			'; include "ignored.bean"',
			'# include "also-ignored.bean"'
		].join('\n');

		expect(__test__.parseIncludes(content)).toEqual(['accounts.bean', 'prices/2026.bean']);
	});

	test('resolves relative and absolute includes from parent files', () => {
		expect(__test__.resolveRemoteInclude('/workspace/main.bean', 'accounts.bean')).toBe(
			'/workspace/accounts.bean'
		);
		expect(__test__.resolveRemoteInclude('/workspace/books/main.bean', '../prices.bean')).toBe(
			'/workspace/prices.bean'
		);
		expect(__test__.resolveRemoteInclude('/workspace/books/main.bean', '/shared/prices.bean')).toBe(
			'/shared/prices.bean'
		);
	});

	test('maps remote files to safe local OPFS paths', () => {
		const remoteFiles = new Map([
			['/workspace/main.bean', 'root'],
			['/workspace/accounts/assets.bean', 'assets']
		]);

		expect(__test__.mapRemoteFilesToLocalPaths('/workspace/main.bean', remoteFiles)).toEqual(
			new Map([
				['main.bean', 'root'],
				['accounts/assets.bean', 'assets']
			])
		);
	});

	test('rejects includes outside the selected root tree', () => {
		const remoteFiles = new Map([
			['/workspace/main.bean', 'root'],
			['/shared/prices.bean', 'prices']
		]);

		expect(() => __test__.mapRemoteFilesToLocalPaths('/workspace/main.bean', remoteFiles)).toThrow(
			'outside the selected root tree'
		);
	});

	test('rewrites absolute, relative, and glob includes to local OPFS paths', () => {
		const localFiles = new Map([
			['main.bean', ['include "/workspace/accounts.bean"', 'include "prices/*.bean"'].join('\n')],
			['accounts.bean', '2026-01-01 open Assets:Cash'],
			['prices/2025.bean', '2025-01-01 price USD 1 EUR'],
			['prices/2026.bean', '2026-01-01 price USD 1 EUR']
		]);

		expect(__test__.rewriteIncludesToLocalPaths('/workspace/main.bean', localFiles)).toEqual(
			new Map([
				[
					'main.bean',
					[
						'include "accounts.bean"',
						'include "prices/2025.bean"',
						'include "prices/2026.bean"'
					].join('\n')
				],
				['accounts.bean', '2026-01-01 open Assets:Cash'],
				['prices/2025.bean', '2025-01-01 price USD 1 EUR'],
				['prices/2026.bean', '2026-01-01 price USD 1 EUR']
			])
		);
	});

	test('rewrites glob includes for workspace-relative root paths', () => {
		const localFiles = new Map([
			['main.bean', 'include "prices/*.bean"'],
			['prices/2024.bean', '2024-01-01 price USD 1 USD'],
			['prices/2025.bean', '2025-01-01 price USD 1 USD']
		]);

		expect(__test__.rewriteIncludesToLocalPaths('main.bean', localFiles).get('main.bean')).toBe(
			['include "prices/2024.bean"', 'include "prices/2025.bean"'].join('\n')
		);
	});
});

describe('CashierSyncBeancount ledger file download', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.mocked(rustledger.createLedger).mockReset().mockImplementation(createMockLedger);
		vi.mocked(rustledger.ensureInitialized).mockReset().mockResolvedValue(undefined);
		mockState.readFailure = undefined;
		mockState.writeFailure = undefined;
		mockState.openFailure = undefined;
		mockState.recoveryWriteFailure = undefined;
		mockState.deleteFailure = undefined;
		mockState.writeAttempts = [];
		mockState.confirmationRows = [];
		mockState.queryErrors = [];
		mockState.onRead.mockReset();
		mockState.onWrite.mockReset();
		mockState.onClose.mockReset();
		mockState.onAbort.mockReset();
		const directory = (prefix = ''): unknown => ({
			getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
			getFileHandle: async (name: string, options?: { create?: boolean }) => {
				const path = `${prefix}${name}`;
				if (path === mockState.readFailure)
					throw new DOMException('Storage unreadable', 'NotAllowedError');
				if (!mockState.opfsFiles.has(path)) {
					if (!options?.create) throw new DOMException('Missing', 'NotFoundError');
					mockState.opfsFiles.set(path, '');
				}
				return {
					getFile: async () => ({
						text: async () => {
							await mockState.onRead(path);
							return mockState.opfsFiles.get(path);
						}
					}),
					createWritable: async () => {
						if (mockState.openFailure === path) {
							mockState.openFailure = undefined;
							throw new Error(`Writer open failed: ${path}`);
						}
						let pending: string | undefined;
						return {
							write: async (data: Uint8Array) => {
								const content = new TextDecoder().decode(data);
								mockState.writeAttempts.push(path);
								pending = content;
								if (path !== 'cashier.bean') mockState.opfsFiles.set(path, content);
								await mockState.onWrite(path, content);
								if (path === mockState.writeFailure) {
									mockState.writeFailure = undefined;
									throw new Error(`Write failed: ${path}`);
								}
								if (
									path === mockState.recoveryWriteFailure &&
									mockState.writeAttempts.filter((attempt) => attempt === path).length > 1
								)
									throw new Error(`Recovery write failed: ${path}`);
							},
							close: async () => {
								await mockState.onClose(path);
								if (pending !== undefined) mockState.opfsFiles.set(path, pending);
							},
							abort: async () => mockState.onAbort(path)
						};
					}
				};
			},
			removeEntry: async (name: string) => {
				const path = `${prefix}${name}`;
				if (path === mockState.deleteFailure) throw new Error(`Delete failed: ${path}`);
				mockState.opfsFiles.delete(path);
			}
		});
		vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory() } });
		mockState.settingsStore.clear();
		mockState.opfsFiles.clear();
		mockState.deleteCache.mockClear();
		mockState.invalidate.mockClear();
		mockState.getErrors.mockReset();
		mockState.getErrors.mockResolvedValue([]);
		mockState.parseErrors = [];
		mockState.createdLedgers = [];
		mockState.pushTransactions.mockReset();
		mockState.pushTransactions.mockRejectedValue(new Error('Push failed'));
		Object.values(mockState.notifier).forEach((fn) => fn.mockClear());
		vi.clearAllMocks();
	});

	afterEach(() => vi.unstubAllGlobals());

	test('restores every attempted file, including a new failing file, after partial replacement', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
		mockState.opfsFiles.set('main.bean', 'old root');
		mockState.opfsFiles.set('accounts.bean', 'old accounts');
		mockState.opfsFiles.set('cashier.bean', '2026-01-01 ! "Draft"');
		const previous = new Map(mockState.opfsFiles);
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([
				['main.bean', 'include "accounts.bean"\ninclude "new.bean"\ninclude "failed.bean"'],
				['accounts.bean', '2026-01-01 open Assets:Cash'],
				['new.bean', '; new'],
				['failed.bean', '; failed']
			])
		);
		mockState.writeFailure = 'failed.bean';
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
		await expect(synchronize()).resolves.toBe(false);
		expect(mockState.opfsFiles).toEqual(previous);
		expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('previous.bean');
		expect(reconcile).not.toHaveBeenCalled();
		expect(getLastDiagnostics()).toMatchObject({
			parseResult: 'ok',
			refreshResult: 'skipped',
			syncErrors: [{ stage: 'pull', message: 'Write failed: failed.bean' }]
		});
	});

	test.each([false, true])(
		'recovers files and root when root selection fails (mutated: %s)',
		async (mutated) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
			mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
			mockState.opfsFiles.set('main.bean', 'old root');
			const previous = new Map(mockState.opfsFiles);
			vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
				new Map([['main.bean', 'candidate']])
			);
			vi.spyOn(settings, 'set').mockImplementationOnce(async (key, value) => {
				if (mutated) mockState.settingsStore.set(key, value);
				throw new Error('Root selection failed');
			});
			await expect(synchronize()).resolves.toBe(false);
			expect(mockState.opfsFiles).toEqual(previous);
			expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('previous.bean');
			expect(getLastDiagnostics()?.syncErrors).toEqual([
				{ stage: 'other', message: 'Root selection failed' }
			]);
		}
	);

	test.each(['main.bean', 'cashier.bean'])(
		'refuses replacement when existing %s is inaccessible',
		async (path) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
			mockState.opfsFiles.set('main.bean', 'old root');
			mockState.opfsFiles.set('cashier.bean', '2026-01-01 ! "Draft"');
			const previous = new Map(mockState.opfsFiles);
			mockState.readFailure = path;
			vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
				new Map([['main.bean', 'candidate']])
			);
			await expect(synchronize()).resolves.toBe(false);
			expect(mockState.writeAttempts).toEqual([]);
			expect(mockState.opfsFiles).toEqual(previous);
			expect(getLastDiagnostics()?.syncErrors).toContainEqual({
				stage: 'pull',
				message: 'Storage unreadable'
			});
		}
	);

	test('reports original failure and all independent recovery failures without reconciliation', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
		mockState.opfsFiles.set('main.bean', 'old root');
		mockState.recoveryWriteFailure = 'main.bean';
		mockState.deleteFailure = 'cashier.bean';
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', 'candidate']])
		);
		vi.spyOn(settings, 'set')
			.mockRejectedValueOnce(new Error('Root selection failed'))
			.mockRejectedValueOnce(new Error('Root recovery failed'));
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
		await expect(synchronize()).resolves.toBe(false);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'other', message: 'Root selection failed' },
			{
				stage: 'pull',
				message: 'Incomplete book recovery: main.bean: Recovery write failed: main.bean'
			},
			{
				stage: 'pull',
				message: 'Incomplete book recovery: cashier.bean: Delete failed: cashier.bean'
			},
			{ stage: 'pull', message: 'Incomplete book recovery: Selected root: Root recovery failed' }
		]);
		expect(reconcile).not.toHaveBeenCalled();
		expect(mockState.invalidate).not.toHaveBeenCalled();
	});

	test('preserves a concurrent draft instead of deleting a newly created overlay during recovery', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
		mockState.opfsFiles.set('main.bean', 'old root');
		const draft = '2026-01-02 ! "Concurrent user draft"';
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', 'candidate']])
		);
		vi.spyOn(settings, 'set').mockImplementationOnce(async () => {
			mockState.opfsFiles.set('cashier.bean', draft);
			throw new Error('Root selection failed');
		});
		await expect(synchronize()).resolves.toBe(false);
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(draft);
		expect(mockState.opfsFiles.get('main.bean')).toBe('old root');
		expect(getLastDiagnostics()?.syncErrors).toContainEqual({
			stage: 'pull',
			message:
				'Incomplete book recovery: cashier.bean: Journal changed during Sync; preserved local content'
		});
	});

	test('does not overwrite a journal that appears after the snapshot absence check', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		const draft = '2026-01-02 ! "Appeared during persistence"';
		mockState.onWrite.mockImplementation(async (path) => {
			if (path === 'main.bean') mockState.opfsFiles.set('cashier.bean', draft);
		});
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', 'candidate']])
		);
		await expect(synchronize()).resolves.toBe(true);
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(draft);
	});

	test.each(['write', 'close'] as const)(
		'recovers when creating the missing overlay fails during %s',
		async (failure) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
			mockState.opfsFiles.set('main.bean', 'old root');
			const previous = new Map(mockState.opfsFiles);
			vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
				new Map([['main.bean', 'candidate']])
			);
			if (failure === 'write') mockState.writeFailure = 'cashier.bean';
			else
				mockState.onClose.mockImplementation(async (path) => {
					if (path === 'cashier.bean') throw new Error('Close failed');
				});
			mockState.onAbort.mockRejectedValue(new Error('Abort failed'));
			await expect(synchronize()).resolves.toBe(false);
			expect(mockState.opfsFiles).toEqual(previous);
			expect(getLastDiagnostics()?.syncErrors?.[0].message).toBe(
				failure === 'write' ? 'Write failed: cashier.bean' : 'Close failed'
			);
		}
	);

	test.each(['initialize', 'parse', 'query'] as const)(
		'preserves the previous book when parser %s fails',
		async (failure) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
			mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
			mockState.opfsFiles.set('main.bean', 'old root');
			const previous = new Map(mockState.opfsFiles);
			vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
				new Map([['main.bean', 'candidate']])
			);
			if (failure === 'initialize')
				vi.spyOn(rustledger, 'ensureInitialized').mockRejectedValueOnce(
					new Error('Parser unavailable')
				);
			else if (failure === 'parse')
				vi.spyOn(rustledger, 'createLedger').mockImplementationOnce(() => {
					throw new Error('Parser unavailable');
				});
			else mockState.queryErrors = ['Confirmation unavailable'];
			await expect(synchronize()).resolves.toBe(false);
			expect(mockState.opfsFiles).toEqual(previous);
			expect(mockState.writeAttempts).toEqual([]);
			expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('previous.bean');
			expect(getLastDiagnostics()).toMatchObject({
				parseResult: 'error',
				refreshResult: 'skipped'
			});
		}
	);

	test.each([
		['missing root', new Map<string, string>()],
		['blank root', new Map([['main.bean', '   ']])],
		['missing include', new Map([['main.bean', 'include "missing.bean"']])],
		[
			'overlay collision',
			new Map([
				['main.bean', 'include "cashier.bean"'],
				['cashier.bean', 'remote journal']
			])
		]
	])('rejects %s before persistence or reconciliation', async (_name, remote) => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
		mockState.opfsFiles.set('main.bean', 'old root');
		mockState.opfsFiles.set('cashier.bean', '2026-01-02 ! "Draft"');
		const previous = new Map(mockState.opfsFiles);
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			remote as Map<string, string>
		);
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
		await expect(synchronize()).resolves.toBe(false);
		expect(mockState.opfsFiles).toEqual(previous);
		expect(mockState.writeAttempts).toEqual([]);
		expect(reconcile).not.toHaveBeenCalled();
		expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('previous.bean');
	});

	test('rolls back file creation when opening a new candidate writer fails', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		mockState.opfsFiles.set('main.bean', 'old root');
		const previous = new Map(mockState.opfsFiles);
		mockState.openFailure = 'new.bean';
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([
				['main.bean', 'include "new.bean"'],
				['new.bean', '; new']
			])
		);
		await expect(synchronize()).resolves.toBe(false);
		expect(mockState.opfsFiles).toEqual(previous);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'pull', message: 'Writer open failed: new.bean' }
		]);
	});

	test('does not reinterpret a previously opened file read failure as absence', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		mockState.opfsFiles.set('main.bean', 'old root');
		mockState.onRead.mockImplementation(async (path) => {
			if (path === 'main.bean') throw new DOMException('File became unreadable', 'NotFoundError');
		});
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', 'candidate']])
		);
		await expect(synchronize()).resolves.toBe(false);
		expect(mockState.opfsFiles.get('main.bean')).toBe('old root');
		expect(mockState.writeAttempts).toEqual([]);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'pull', message: 'File became unreadable' }
		]);
	});

	test('restores the book when closing its writer fails and abort also rejects', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		mockState.opfsFiles.set('main.bean', 'old root');
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', 'candidate']])
		);
		mockState.onClose.mockRejectedValueOnce(new Error('Book close failed'));
		mockState.onAbort.mockRejectedValue(new Error('Abort failed'));
		await expect(synchronize()).resolves.toBe(false);
		expect(mockState.opfsFiles.get('main.bean')).toBe('old root');
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'pull', message: 'Book close failed' }
		]);
	});

	test('adds the configured bearer token to server requests', async () => {
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(new Response('"pong"', { status: 200 }));
		const sync = new CashierSyncBeancount('https://cashier.example.test/api', 'secret-token');

		await sync.healthCheck();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, options] = fetchMock.mock.calls[0];
		expect(url.toString()).toBe('https://cashier.example.test/api/ping');
		expect(new Headers(options?.headers).get('Authorization')).toBe(
			['Bearer', 'secret-token'].join(' ')
		);
	});

	test('fetches nested includes once and handles include cycles', async () => {
		const sync = new CashierSyncBeancount('https://cashier.example.test');
		const readFiles = vi.spyOn(sync, 'readFiles').mockImplementation(async (path: string) => {
			const files: Record<string, string> = {
				'main.bean': [
					'include "accounts.bean"',
					'include "accounts.bean"',
					'include "prices/2026.bean"'
				].join('\n'),
				'accounts.bean': 'include "main.bean"',
				'prices/2026.bean': '2026-01-01 price USD 1 EUR'
			};
			const content = files[path];
			if (content === undefined) throw new Error(`missing ${path}`);
			return new Map([[path, content]]);
		});

		const files = await sync.readLedgerFiles('/workspace/main.bean');

		expect(files).toEqual(
			new Map([
				['main.bean', expect.any(String)],
				['accounts.bean', 'include "main.bean"'],
				['prices/2026.bean', '2026-01-01 price USD 1 EUR']
			])
		);
		expect(readFiles).toHaveBeenCalledTimes(3);
	});

	test('fetches glob include responses as concrete files', async () => {
		const sync = new CashierSyncBeancount('https://cashier.example.test');
		vi.spyOn(sync, 'readFiles').mockImplementation(async (path: string) => {
			if (path === 'main.bean') {
				return new Map([['main.bean', 'include "prices/*.bean"']]);
			}
			if (path === 'prices/*.bean') {
				return new Map([
					['prices/2024.bean', '2024-01-01 price USD 1 USD'],
					['prices/2025.bean', '2025-01-01 price USD 1 USD']
				]);
			}
			throw new Error(`missing ${path}`);
		});

		await expect(sync.readLedgerFiles('/workspace/main.bean')).resolves.toEqual(
			new Map([
				['main.bean', 'include "prices/*.bean"'],
				['prices/2024.bean', '2024-01-01 price USD 1 USD'],
				['prices/2025.bean', '2025-01-01 price USD 1 USD']
			])
		);
	});

	test('does not expose mutating Stage 1 server methods', () => {
		const sync = new CashierSyncBeancount('https://cashier.example.test');

		expect('search' in sync).toBe(false);
		expect('xact' in sync).toBe(false);
		expect('shutdown' in sync).toBe(false);
	});

	test('always pulls and refreshes the full book without reference-data HTTP queries', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test/api');
		mockState.settingsStore.set(SettingKeys.syncApiToken, 'device-token');
		const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
			const url = new URL(String(input));
			expect(url.pathname).toBe('/api/infrastructure');
			expect(url.searchParams.has('query')).toBe(false);
			expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer device-token');
			return new Response(JSON.stringify({ content: '2026-01-01 open Assets:Cash' }));
		});
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');

		await expect(synchronize()).resolves.toBe(true);

		expect(network).toHaveBeenCalledTimes(1);
		expect(mockState.pushTransactions).not.toHaveBeenCalled();
		expect(reconcile).toHaveBeenCalledWith([], ['main.bean'], { accepted: [], confirmedIds: [] });
		expect(reconcile.mock.invocationCallOrder[0]).toBeLessThan(
			mockState.invalidate.mock.invocationCallOrder[0]
		);
		expect(mockState.opfsFiles.get('cashier.bean')).toBe('');
		expect(getLastDiagnostics()).toMatchObject({
			parseResult: 'ok',
			refreshResult: 'ok'
		});
	});

	test.each(['deleteCache', 'invalidate'] as const)(
		'reports %s failure separately without restoring confirmed overlays',
		async (method) => {
			mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
			const confirmed =
				'2026-01-01 * "Confirmed"\n    cashier_id: "confirmed-id"\n    Expenses:Food  1 USD\n    Assets:Cash  -1 USD';
			mockState.opfsFiles.set('cashier.bean', confirmed);
			mockState.confirmationRows = [['confirmed-id']];
			mockState.pushTransactions.mockResolvedValueOnce({
				synchronized: ['confirmed-id'],
				rejected: []
			});
			vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
				new Map([['main.bean', confirmed]])
			);
			mockState[method].mockRejectedValueOnce(new Error('analysis unavailable'));

			await expect(synchronize()).resolves.toBe(false);

			expect(mockState.opfsFiles.get('cashier.bean')?.trim()).toBe('');
			expect(mockState.opfsFiles.get('main.bean')).toBe(confirmed);
			expect(getLastDiagnostics()).toMatchObject({
				parseResult: 'ok',
				refreshResult: 'error',
				syncErrors: [
					{ stage: 'refresh', message: 'Failed to refresh local analysis: analysis unavailable' }
				]
			});
			expect(get(syncProgress).find((step) => step.id === 9)?.status).toBe('completed');
		}
	);

	test('sends only completed entries and retries persisted identities with exact total prices', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		const draft = '2026-01-02 ! "Draft"\n    Assets:Cash  -1 USD\n    Expenses:Food  1 USD';
		const totalPrice = '    Assets:Broker  3 LONGCOIN @@ 10.01 USD';
		mockState.opfsFiles.set(
			'cashier.bean',
			`2026-01-01 * "Trade"\n${totalPrice}\n    Assets:Cash  -10.01 USD\n\n${draft}\n`
		);
		mockState.pushTransactions.mockResolvedValue({ synchronized: [], rejected: [] });
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', '2026-01-01 open Assets:Cash']])
		);

		await expect(synchronize()).resolves.toBe(false);
		const afterFirstRun = mockState.opfsFiles.get('cashier.bean');
		await expect(synchronize()).resolves.toBe(false);

		expect(mockState.pushTransactions).toHaveBeenCalledTimes(2);
		const firstBatch = mockState.pushTransactions.mock.calls[0][1];
		expect(firstBatch).toEqual([
			expect.objectContaining({ rawText: expect.stringContaining(totalPrice) })
		]);
		expect(firstBatch).toEqual(mockState.pushTransactions.mock.calls[1][1]);
		expect(JSON.stringify(firstBatch)).not.toContain('Draft');
		expect(mockState.opfsFiles.get('cashier.bean')).toBe(afterFirstRun);
		expect(afterFirstRun).toContain(draft);
		expect(afterFirstRun?.match(/cashier_id:/g)).toHaveLength(1);
	});

	test.each(['pull', 'parse'] as const)(
		'retries accepted exact-total content after failed %s, confirms once, and preserves the draft',
		async (failure) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			await initWasm({
				module_or_path: readFileSync(
					new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
				)
			});
			vi.spyOn(rustledger, 'createLedger').mockImplementation((files, root) =>
				Ledger.fromFiles(files, root)
			);
			mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
			const draft = '2026-01-02 ! "Draft"\n    Assets:Cash -1 USD\n    Expenses:Food 1 USD\n';
			const total = '    Assets:Broker 3 LONGCOIN @@ 10.01 USD';
			mockState.opfsFiles.set(
				'cashier.bean',
				`2026-01-01 * "Trade"\n${total}\n    Assets:Cash -10.01 USD\n\n${draft}`
			);
			const server = new Map<string, string>();
			mockState.pushTransactions.mockImplementation(async (_url, batch) => {
				const pending = batch as PendingTransaction[];
				for (const entry of pending) {
					expect(entry.rawText).toContain(total);
					expect(entry.rawText).not.toContain('Draft');
					if (server.has(entry.cashierId)) expect(server.get(entry.cashierId)).toBe(entry.rawText);
					server.set(entry.cashierId, entry.rawText);
				}
				return { synchronized: pending.map((entry) => entry.cashierId), rejected: [] };
			});
			let first = true;
			vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockImplementation(async () => {
				if (first) {
					first = false;
					if (failure === 'pull') throw new Error('Pull unavailable');
					return new Map([['main.bean', 'not a valid directive']]);
				}
				return new Map([
					[
						'main.bean',
						`2000-01-01 open Assets:Cash\n2000-01-01 open Assets:Broker\n2000-01-01 open Expenses:Food\n${[...server.values()].join('\n')}`
					]
				]);
			});
			await expect(synchronize()).resolves.toBe(false);
			const persisted = mockState.opfsFiles.get('cashier.bean');
			expect(persisted).toContain(draft);
			expect(persisted?.match(/cashier_id:/g)).toHaveLength(1);
			const journalsAtRefresh: Array<string | undefined> = [];
			mockState.invalidate.mockImplementation(async () => {
				journalsAtRefresh.push(mockState.opfsFiles.get('cashier.bean'));
			});
			await expect(synchronize()).resolves.toBe(true);
			await expect(synchronize()).resolves.toBe(true);
			expect(mockState.pushTransactions).toHaveBeenCalledTimes(2);
			expect(mockState.pushTransactions.mock.calls[0][1]).toEqual(
				mockState.pushTransactions.mock.calls[1][1]
			);
			expect(server.size).toBe(1);
			expect(mockState.opfsFiles.get('cashier.bean')).toContain(draft);
			expect(mockState.opfsFiles.get('cashier.bean')).not.toContain('Trade');
			expect(journalsAtRefresh).toHaveLength(2);
			for (const journal of journalsAtRefresh) {
				expect(journal).toContain(draft);
				expect(journal).not.toContain('Trade');
			}
		}
	);

	test('derives confirmation only from parsed completed transaction-owned metadata (real WASM)', async () => {
		await initWasm({
			module_or_path: readFileSync(
				new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
			)
		});
		vi.spyOn(rustledger, 'createLedger').mockImplementation((files, root) =>
			Ledger.fromFiles(files, root)
		);
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		const source = `2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
; cashier_id: "comment-id"
2026-01-01 * "Completed"
  cashier_id: "transaction-id"
  Assets:Cash -1 USD
    cashier_id: "posting-id"
  Expenses:Food 1 USD
2026-01-02 ! "Draft"
  cashier_id: "draft-id"
  Assets:Cash -1 USD
  Expenses:Food 1 USD
2026-01-03 note Assets:Cash "Not a transaction"
  cashier_id: "note-id"
2026-01-04 * "Completed without postings"
  cashier_id: "zero-posting-id"
2026-01-05 ! "Draft without postings"
  cashier_id: "zero-posting-draft-id"
`;
		const ledger = Ledger.fromFiles({ 'main.bean': source }, 'main.bean');
		try {
			expect(ledger.getErrors()).toEqual([]);
			expect(
				ledger.getDirectives().find((directive) => directive.type === 'transaction')
			).not.toHaveProperty('metadata');
		} finally {
			ledger.free();
		}
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', source]])
		);
		const local = '2026-01-04 * "Completed without postings"\n  cashier_id: "zero-posting-id"';
		mockState.opfsFiles.set('cashier.bean', local);
		mockState.pushTransactions.mockResolvedValue({
			synchronized: ['zero-posting-id'],
			rejected: []
		});
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
		await expect(synchronize()).resolves.toBe(true);
		expect(reconcile).toHaveBeenCalledWith([], ['main.bean'], {
			accepted: [{ cashierId: 'zero-posting-id', rawText: local }],
			confirmedIds: ['transaction-id', 'zero-posting-id']
		});
		expect(mockState.opfsFiles.get('cashier.bean')).toBe('');
	});

	test.each([
		['lost', undefined],
		['malformed', { synchronized: ['local-id'], rejected: null }],
		['malformed rejection', { synchronized: ['local-id'], rejected: [null] }],
		['omitted', { synchronized: [], rejected: [] }],
		[
			'rejected',
			{ synchronized: ['local-id'], rejected: [{ cashier_id: 'local-id', reason: 'Conflict' }] }
		]
	])(
		'passes no acceptance for %s outcomes even with a parsed matching server ID',
		async (outcome, response) => {
			mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
			const local = '2026-01-01 * "Local"\n    cashier_id: "local-id"';
			mockState.opfsFiles.set('cashier.bean', local);
			mockState.confirmationRows = [['local-id']];
			if (outcome === 'lost')
				mockState.pushTransactions.mockRejectedValue(new Error('Response lost'));
			else mockState.pushTransactions.mockResolvedValue(response);
			vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
				new Map([['main.bean', 'server snapshot']])
			);
			const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
			await expect(synchronize()).resolves.toBe(false);
			if (outcome === 'omitted') {
				expect(getLastDiagnostics()?.syncErrors).toEqual([
					{
						stage: 'send',
						cashierId: 'local-id',
						message: 'Server omitted the transaction outcome; retry Sync to resolve it.'
					}
				]);
				expect(get(syncProgress).find((step) => step.id === 0)?.status).toBe('error');
				expect(getLastDiagnostics()).toMatchObject({ parseResult: 'ok', refreshResult: 'ok' });
			}
			expect(reconcile).toHaveBeenCalledWith(
				outcome === 'rejected' ? ['local-id'] : [],
				['main.bean'],
				{ accepted: [], confirmedIds: ['local-id'] }
			);
			expect(mockState.opfsFiles.get('cashier.bean')).toBe(local);
		}
	);

	test('passes only submitted acknowledged non-rejected entries with their original content', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		const pending = ['accepted', 'rejected', 'omitted'].map((cashierId) => ({
			cashierId,
			rawText: `2026-01-01 * "${cashierId}"\n    cashier_id: "${cashierId}"`
		}));
		vi.spyOn(manualWriteback, 'prepareLocalTransactions').mockResolvedValue(pending);
		mockState.pushTransactions.mockResolvedValue({
			synchronized: ['accepted', 'rejected', 'not-submitted'],
			rejected: [{ cashier_id: 'rejected', reason: 'Conflict' }]
		});
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', 'snapshot']])
		);
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
		await expect(synchronize()).resolves.toBe(false);
		expect(reconcile).toHaveBeenCalledWith(['rejected'], ['main.bean'], {
			accepted: [pending[0]],
			confirmedIds: []
		});
	});

	test('reports each omitted outcome while reconciling only separately acknowledged entries', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		const blocks = ['accepted', 'omitted-one', 'omitted-two'].map(
			(id) => `2026-01-01 * "${id}"\n  cashier_id: "${id}"`
		);
		mockState.opfsFiles.set('cashier.bean', blocks.join('\n\n'));
		mockState.confirmationRows = [['accepted'], ['omitted-one'], ['omitted-two']];
		mockState.pushTransactions.mockResolvedValue({ synchronized: ['accepted'], rejected: [] });
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', blocks.join('\n\n')]])
		);
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
		await expect(synchronize()).resolves.toBe(false);
		expect(getLastDiagnostics()?.syncErrors).toEqual(
			['omitted-one', 'omitted-two'].map((cashierId) => ({
				stage: 'send',
				cashierId,
				message: 'Server omitted the transaction outcome; retry Sync to resolve it.'
			}))
		);
		expect(reconcile).toHaveBeenCalledWith([], ['main.bean'], {
			accepted: [{ cashierId: 'accepted', rawText: blocks[0] }],
			confirmedIds: ['accepted', 'omitted-one', 'omitted-two']
		});
		expect(mockState.opfsFiles.get('cashier.bean')).not.toContain('"accepted"');
		expect(mockState.opfsFiles.get('cashier.bean')).toContain(blocks[1]);
		expect(mockState.opfsFiles.get('cashier.bean')).toContain(blocks[2]);
		expect(getLastDiagnostics()).toMatchObject({ parseResult: 'ok', refreshResult: 'ok' });
	});

	test('passes no acceptance after preparation failure and still pulls', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.test');
		vi.spyOn(manualWriteback, 'prepareLocalTransactions').mockRejectedValue(
			new Error('Identity persistence failed')
		);
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', 'snapshot']])
		);
		const reconcile = vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths');
		await expect(synchronize()).resolves.toBe(false);
		expect(mockState.pushTransactions).not.toHaveBeenCalled();
		expect(reconcile).toHaveBeenCalledWith([], ['main.bean'], { accepted: [], confirmedIds: [] });
	});

	test('does not reintroduce a confirmed local overlay on repeated sync', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-01-01 * "Local"',
				'    cashier_id: "confirmed-uuid"',
				'    Expenses:Food  10 USD',
				'    Assets:Cash'
			].join('\n')
		);
		mockState.confirmationRows = [['confirmed-uuid']];
		mockState.pushTransactions.mockResolvedValueOnce({
			synchronized: ['confirmed-uuid'],
			rejected: []
		});

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([
				[
					'main.bean',
					[
						'2026-01-01 * "Local"',
						'    cashier_id: "confirmed-uuid"',
						'    Expenses:Food  10 USD',
						'    Assets:Cash'
					].join('\n')
				]
			])
		);

		const cashierContentsWhenUiLedgerRefreshes: Array<string | undefined> = [];
		mockState.invalidate.mockImplementation(async () => {
			cashierContentsWhenUiLedgerRefreshes.push(mockState.opfsFiles.get('cashier.bean'));
		});

		await expect(synchronize()).resolves.toBe(true);
		await expect(synchronize()).resolves.toBe(true);

		expect(mockState.opfsFiles.get('cashier.bean')?.trim()).toBe('');
		expect(cashierContentsWhenUiLedgerRefreshes).toEqual(['', '']);
	});

	test('preserves existing cashier.bean and rewrites synced includes', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set('cashier.bean', '2026-01-01 * "Local"');
		mockState.pushTransactions.mockImplementationOnce(async (_url, batch) => ({
			synchronized: (batch as PendingTransaction[]).map((entry) => entry.cashierId),
			rejected: []
		}));

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([
				['main.bean', ['include "accounts.bean"', 'include "prices/2026.bean"'].join('\n')],
				['accounts.bean', '2026-01-01 open Assets:Cash'],
				['prices/2026.bean', '2026-01-01 price USD 1 EUR']
			])
		);

		await expect(synchronize()).resolves.toBe(true);

		expect(mockState.pushTransactions).toHaveBeenCalledTimes(1);
		expect(mockState.pushTransactions).toHaveBeenCalledWith(
			'https://cashier.example.test',
			expect.arrayContaining([
				expect.objectContaining({
					rawText: expect.stringMatching(/^2026-01-01 \* "Local"\n    cashier_id: "[^"]+"$/)
				})
			]),
			''
		);
		expect(mockState.opfsFiles.get('cashier.bean')).toMatch(
			/^2026-01-01 \* "Local"\n    cashier_id: "[^"]+"$/
		);
		expect(mockState.opfsFiles.get('main.bean')).toBe(
			['include "accounts.bean"', 'include "prices/2026.bean"'].join('\n')
		);
		expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('main.bean');
		expect(mockState.deleteCache).toHaveBeenCalledTimes(1);
		expect(mockState.invalidate).toHaveBeenCalledTimes(1);
		expect(getLastDiagnostics()).toMatchObject({
			ledgerFilesCount: 3,
			selectedRootBookFilename: 'main.bean',
			parseResult: 'ok'
		});
	});

	test('records pull, root-book-selection, and parse failures separately', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const pullError = new Error('pull unavailable');
		const bookSelectionError = new Error('book selection unavailable');
		const parseError = new Error('Full ledger parsed with 1 errors for main.bean');
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockRejectedValueOnce(pullError);
		await expect(synchronize()).resolves.toBe(false);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'pull', message: 'pull unavailable' }
		]);

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValueOnce(
			new Map([['main.bean', '2026-01-01 open Assets:Cash']])
		);
		vi.spyOn(settings, 'set').mockRejectedValueOnce(bookSelectionError);
		await expect(synchronize()).resolves.toBe(false);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'other', message: 'book selection unavailable' }
		]);

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValueOnce(
			new Map([['main.bean', '2026-01-01 open Assets:Cash']])
		);
		mockState.parseErrors = [{ message: 'parse unavailable' }];
		await expect(synchronize()).resolves.toBe(false);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'parse', message: 'Full ledger parsed with 1 errors for main.bean' }
		]);
		expect(consoleError.mock.calls).toEqual([[pullError], [bookSelectionError], [parseError]]);
	});

	test('records multiple server rejections and clears them at the next run', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set(
			'cashier.bean',
			'2026-06-01 * "Local"\n    cashier_id: "local-1"\n    Assets:Cash -1 USD\n    Equity:Opening-Balances 1 USD'
		);
		mockState.pushTransactions.mockResolvedValueOnce({
			synchronized: [],
			rejected: [
				{ cashier_id: 'local-1', reason: 'first rejection' },
				{ cashier_id: 'local-2', reason: 'second rejection' }
			]
		});
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', '2026-01-01 open Assets:Cash']])
		);

		await expect(synchronize()).resolves.toBe(false);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'send', message: 'first rejection', cashierId: 'local-1' },
			{ stage: 'send', message: 'second rejection', cashierId: 'local-2' }
		]);

		mockState.pushTransactions.mockResolvedValueOnce({ synchronized: ['local-1'], rejected: [] });
		await expect(synchronize()).resolves.toBe(true);
		expect(getLastDiagnostics()?.syncErrors).toEqual([]);
	});

	test('records a reconciliation failure after an otherwise valid pull', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set(
			'cashier.bean',
			'2026-06-01 * "Local"\n    cashier_id: "local-1"\n    Assets:Cash -1 USD\n    Equity:Opening-Balances 1 USD'
		);
		mockState.pushTransactions.mockResolvedValueOnce({ synchronized: ['local-1'], rejected: [] });
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValueOnce(
			new Map([['main.bean', '2026-01-01 open Assets:Cash']])
		);
		vi.spyOn(manualWriteback, 'reconcileLocalJournalFromPaths').mockRejectedValueOnce(
			new Error('reconcile unavailable')
		);

		await expect(synchronize()).resolves.toBe(false);
		expect(getLastDiagnostics()?.syncErrors).toEqual([
			{ stage: 'reconcile', message: 'Failed to reconcile local journal: reconcile unavailable' }
		]);
	});

	test('failed xact push keeps local entries, marks send step error, and prevents full success', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set(
			'cashier.bean',
			'2026-06-01 * "Local" "Test"\n    Expenses:Food  10 USD\n    Assets:Cash'
		);

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', '2026-01-01 open Assets:Cash']])
		);

		// mockState.pushTransactions already rejects by default
		await expect(synchronize()).resolves.toBe(false);

		const steps = get(syncProgress);
		const step0 = steps.find((s) => s.id === 0);
		const step6 = steps.find((s) => s.id === 6);
		expect(step0?.status).toBe('error');
		expect(step6?.status).toBe('completed');
		expect(mockState.opfsFiles.get('cashier.bean')).toContain('cashier_id:');
	});

	test('rejected writeback keeps local transaction without turning downloaded ledger parse red', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-05 * "QAEDGE UI Invalid"',
				'    cashier_id: "11111111-1111-4111-8111-111111111111"',
				'    Assets:NoSuchBank:Cash  -2.22 GBP',
				'    Expenses:Groceries       2.22 GBP'
			].join('\n')
		);
		mockState.pushTransactions.mockResolvedValueOnce({
			synchronized: [],
			rejected: [
				{
					cashier_id: '11111111-1111-4111-8111-111111111111',
					reason: 'Unknown account(s): Assets:NoSuchBank:Cash'
				}
			]
		});
		mockState.invalidate.mockRejectedValueOnce(
			new Error('Account Assets:NoSuchBank:Cash was never opened')
		);

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', '2026-01-01 open Assets:Physical:Cash']])
		);

		await expect(synchronize()).resolves.toBe(false);

		const steps = get(syncProgress);
		expect(steps.find((s) => s.id === 0)?.status).toBe('error');
		expect(steps.find((s) => s.id === 8)?.status).toBe('completed');
		expect(getLastDiagnostics()).toMatchObject({
			parseResult: 'ok',
			parseErrorCount: 0,
			refreshResult: 'error',
			lastError:
				'Failed to refresh local analysis: Account Assets:NoSuchBank:Cash was never opened',
			syncErrors: [
				{
					stage: 'send',
					message: 'Unknown account(s): Assets:NoSuchBank:Cash',
					cashierId: '11111111-1111-4111-8111-111111111111'
				},
				{
					stage: 'refresh',
					message:
						'Failed to refresh local analysis: Account Assets:NoSuchBank:Cash was never opened'
				}
			]
		});
		expect(mockState.notifier.warning).toHaveBeenCalledWith(
			'Unknown account(s): Assets:NoSuchBank:Cash'
		);
		expect(mockState.opfsFiles.get('cashier.bean')).toContain('Assets:NoSuchBank:Cash');
		expect(mockState.createdLedgers[0]).toMatchObject({
			entryPoint: 'main.bean',
			files: { 'main.bean': '2026-01-01 open Assets:Physical:Cash' }
		});
	});

	test('repeated rejected writeback keeps surfacing the backend reason', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set(
			'cashier.bean',
			[
				'2026-06-18 * "STAGE2FIXQA Invalid Cafe" "invalid browser sync qa"',
				'    cashier_id: "11111111-1111-4111-8111-111111111111"',
				'    Expenses:EatingOut:Coffee  1.11 USD',
				'    Assets:NoSuchBank:Cash    -1.11 USD'
			].join('\n')
		);
		const rejection = {
			synchronized: [],
			rejected: [
				{
					cashier_id: '11111111-1111-4111-8111-111111111111',
					reason: 'Unknown account(s): Assets:NoSuchBank:Cash'
				}
			]
		};
		mockState.pushTransactions.mockResolvedValueOnce(rejection).mockResolvedValueOnce(rejection);

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['main.bean', '2026-01-01 open Assets:Physical:Cash']])
		);

		await expect(synchronize()).resolves.toBe(false);
		await expect(synchronize()).resolves.toBe(false);

		expect(mockState.notifier.warning).toHaveBeenCalledWith(
			'Unknown account(s): Assets:NoSuchBank:Cash'
		);
		expect(
			mockState.notifier.warning.mock.calls.filter(
				([message]) => message === 'Unknown account(s): Assets:NoSuchBank:Cash'
			)
		).toHaveLength(2);
		expect(getLastDiagnostics()?.lastError).toBe('Unknown account(s): Assets:NoSuchBank:Cash');
		expect(mockState.opfsFiles.get('cashier.bean')).toContain('Assets:NoSuchBank:Cash');
	});

	test('rolls back downloaded files and selected book on parse failure', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('Full ledger parsed with 1 errors for main.bean');
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
		mockState.opfsFiles.set('main.bean', 'old root');
		mockState.opfsFiles.set('accounts.bean', 'old include');
		mockState.parseErrors = [{ message: 'parse failed' }];

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([
				['main.bean', 'include "accounts.bean"'],
				['accounts.bean', '2026-01-01 open Assets:Cash']
			])
		);

		await expect(synchronize()).resolves.toBe(false);

		expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('previous.bean');
		expect(mockState.opfsFiles.get('main.bean')).toBe('old root');
		expect(mockState.opfsFiles.get('accounts.bean')).toBe('old include');
		expect(mockState.deleteCache).not.toHaveBeenCalled();
		expect(mockState.invalidate).not.toHaveBeenCalled();
		expect(getLastDiagnostics()).toMatchObject({
			parseResult: 'error',
			selectedRootBookFilename: 'main.bean'
		});
		expect(consoleError.mock.calls).toEqual([
			[expect.objectContaining({ message: error.message })]
		]);
	});

	test('rejects downloaded infrastructure that would overwrite cashier.bean', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('Invalid local OPFS path for /workspace/cashier.bean');
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/cashier.bean');
		mockState.opfsFiles.set('cashier.bean', '2026-01-01 * "Local"');

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['/workspace/cashier.bean', 'server content']])
		);

		await expect(synchronize()).resolves.toBe(false);

		expect(mockState.opfsFiles.get('cashier.bean')).toMatch(
			/^2026-01-01 \* "Local"\n    cashier_id: "[^"]+"$/
		);
		expect(mockState.deleteCache).not.toHaveBeenCalled();
		expect(getLastDiagnostics()).toMatchObject({
			parseResult: 'skipped',
			refreshResult: 'skipped'
		});
		expect(consoleError.mock.calls).toEqual([
			[expect.objectContaining({ message: error.message })]
		]);
	});

	test('failed include fetch rejects before OPFS writes', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('missing /workspace/accounts.bean');
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockRejectedValue(error);

		await expect(synchronize()).resolves.toBe(false);

		expect(vi.mocked(opfs.saveFile)).not.toHaveBeenCalled();
		expect(getLastDiagnostics()).toMatchObject({
			parseResult: 'skipped',
			refreshResult: 'skipped'
		});
		expect(consoleError.mock.calls).toEqual([[error]]);
	});
});

for (const method of ['readFiles'] as const) {
	for (const status of [401, 403, 500]) {
		test(`D4 ${method} classifies HTTP ${status} without response secrets`, async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockResolvedValue(new Response('Authorization: Bearer sensitive-token', { status }))
			);
			const client = new CashierSyncBeancount('https://cashier.test/api', 'sensitive-token');
			const call = () => client.readFiles('main.bean');
			await expect(call()).rejects.toThrow(`HTTP ${status}`);
			await expect(call()).rejects.not.toThrow('sensitive-token');
			vi.unstubAllGlobals();
		});
	}
	test(`D4 ${method} transport failure is not invalid-token diagnosis`, async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
		const client = new CashierSyncBeancount('https://cashier.test/api');
		await expect(client.readFiles('main.bean')).rejects.toThrow('Failed to fetch');
		vi.unstubAllGlobals();
	});
}
