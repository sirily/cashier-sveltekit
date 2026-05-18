import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	const settingsStore = new Map<string, unknown>();
	const opfsFiles = new Map<string, string>();
	return {
		settingsStore,
		opfsFiles,
		syncAccounts: vi.fn(async () => {}),
		syncPayees: vi.fn(async () => {}),
		deleteCache: vi.fn(async () => {}),
		invalidate: vi.fn(async () => {}),
		getErrors: vi.fn<() => Promise<unknown[]>>(async () => []),
		notifier: {
			init: vi.fn(),
			success: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			warning: vi.fn()
		}
	};
});

vi.mock('$lib/utils/notifier', () => ({
	default: mockState.notifier
}));

vi.mock('$lib/settings', () => ({
	SettingKeys: {
		syncServerUrl: 'syncServerUrl',
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

vi.mock('$lib/utils/opfslib', () => ({
	readFile: vi.fn(async (path: string) => mockState.opfsFiles.get(path)),
	saveFile: vi.fn(async (path: string, content: string) => {
		mockState.opfsFiles.set(path, content);
	}),
	fileExists: vi.fn(async (path: string) => mockState.opfsFiles.has(path)),
	deleteFile: vi.fn(async (path: string) => {
		mockState.opfsFiles.delete(path);
		return true;
	})
}));

vi.mock('$lib/services/ledgerWorkerClient', () => ({
	default: {
		deleteCache: mockState.deleteCache,
		invalidate: mockState.invalidate,
		getErrors: mockState.getErrors
	}
}));

vi.mock('$lib/sync/sync-common', () => ({
	syncAccounts: mockState.syncAccounts,
	syncPayees: mockState.syncPayees,
	syncCurrentValues: vi.fn(async () => {
		throw new Error('not used in tests');
	})
}));

import * as opfs from '$lib/utils/opfslib';
import { SettingKeys } from '$lib/settings';
import {
	CashierSyncBeancount,
	__test__,
	getLastDiagnostics,
	synchronize
} from '$lib/sync/sync-beancount';

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

	test('rewrites absolute and relative includes to local OPFS paths', () => {
		const localFiles = new Map([
			[
				'main.bean',
				['include "/workspace/accounts.bean"', 'include "prices/2026.bean"'].join('\n')
			],
			['accounts.bean', '2026-01-01 open Assets:Cash'],
			['prices/2026.bean', '2026-01-01 price USD 1 EUR']
		]);

		expect(__test__.rewriteIncludesToLocalPaths('/workspace/main.bean', localFiles)).toEqual(
			new Map([
				['main.bean', ['include "accounts.bean"', 'include "prices/2026.bean"'].join('\n')],
				['accounts.bean', '2026-01-01 open Assets:Cash'],
				['prices/2026.bean', '2026-01-01 price USD 1 EUR']
			])
		);
	});
});

describe('CashierSyncBeancount ledger file download', () => {
	beforeEach(() => {
		mockState.settingsStore.clear();
		mockState.opfsFiles.clear();
		mockState.syncAccounts.mockClear();
		mockState.syncPayees.mockClear();
		mockState.deleteCache.mockClear();
		mockState.invalidate.mockClear();
		mockState.getErrors.mockReset();
		mockState.getErrors.mockResolvedValue([]);
		Object.values(mockState.notifier).forEach((fn) => fn.mockClear());
		vi.clearAllMocks();
	});

	test('fetches nested includes once and handles include cycles', async () => {
		const sync = new CashierSyncBeancount('https://cashier.example.test');
		const readFile = vi.spyOn(sync, 'readFile').mockImplementation(async (path: string) => {
			const files: Record<string, string> = {
				'/workspace/main.bean': [
					'include "accounts.bean"',
					'include "accounts.bean"',
					'include "prices/2026.bean"'
				].join('\n'),
				'/workspace/accounts.bean': 'include "main.bean"',
				'/workspace/prices/2026.bean': '2026-01-01 price USD 1 EUR'
			};
			const content = files[path];
			if (content === undefined) throw new Error(`missing ${path}`);
			return content;
		});

		const files = await sync.readLedgerFiles('/workspace/main.bean');

		expect(files).toEqual(
			new Map([
				['/workspace/main.bean', expect.any(String)],
				['/workspace/accounts.bean', 'include "main.bean"'],
				['/workspace/prices/2026.bean', '2026-01-01 price USD 1 EUR']
			])
		);
		expect(readFile).toHaveBeenCalledTimes(3);
	});

	test('does not expose mutating Stage 1 server methods', () => {
		const sync = new CashierSyncBeancount('https://cashier.example.test');

		expect('search' in sync).toBe(false);
		expect('xact' in sync).toBe(false);
		expect('shutdown' in sync).toBe(false);
	});

	test('preserves existing cashier.bean and rewrites synced includes', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.opfsFiles.set('cashier.bean', '2026-01-01 * "Local"');

		vi.spyOn(CashierSyncBeancount.prototype, 'readAccounts').mockResolvedValue({
			rows: [['10', 'USD', 'Assets:Cash']]
		});
		vi.spyOn(CashierSyncBeancount.prototype, 'readPayees').mockResolvedValue(['Shop']);
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([
				[
					'/workspace/main.bean',
					['include "/workspace/accounts.bean"', 'include "prices/2026.bean"'].join('\n')
				],
				['/workspace/accounts.bean', '2026-01-01 open Assets:Cash'],
				['/workspace/prices/2026.bean', '2026-01-01 price USD 1 EUR']
			])
		);

		await expect(
			synchronize({ syncAccounts: true, syncPayees: true, syncLedgerFiles: true })
		).resolves.toBe(true);

		expect(mockState.opfsFiles.get('cashier.bean')).toBe('2026-01-01 * "Local"');
		expect(mockState.opfsFiles.get('main.bean')).toBe(
			['include "accounts.bean"', 'include "prices/2026.bean"'].join('\n')
		);
		expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('main.bean');
		expect(mockState.deleteCache).toHaveBeenCalledTimes(1);
		expect(mockState.invalidate).toHaveBeenCalledTimes(1);
		expect(getLastDiagnostics()).toMatchObject({
			accountsCount: 1,
			payeesCount: 1,
			ledgerFilesCount: 3,
			selectedRootBookFilename: 'main.bean',
			parseResult: 'ok'
		});
	});

	test('rolls back downloaded files and selected book on parse failure', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');
		mockState.settingsStore.set(SettingKeys.bookFilename, 'previous.bean');
		mockState.opfsFiles.set('main.bean', 'old root');
		mockState.opfsFiles.set('accounts.bean', 'old include');
		mockState.getErrors
			.mockResolvedValueOnce([{ message: 'parse failed' }] as unknown[])
			.mockResolvedValueOnce([]);

		vi.spyOn(CashierSyncBeancount.prototype, 'readPayees').mockResolvedValue(['Shop']);
		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([
				['/workspace/main.bean', 'include "accounts.bean"'],
				['/workspace/accounts.bean', '2026-01-01 open Assets:Cash']
			])
		);

		await expect(synchronize({ syncPayees: true, syncLedgerFiles: true })).resolves.toBe(false);

		expect(mockState.settingsStore.get(SettingKeys.bookFilename)).toBe('previous.bean');
		expect(mockState.opfsFiles.get('main.bean')).toBe('old root');
		expect(mockState.opfsFiles.get('accounts.bean')).toBe('old include');
		expect(mockState.deleteCache).toHaveBeenCalledTimes(2);
		expect(mockState.invalidate).toHaveBeenCalledTimes(2);
		expect(getLastDiagnostics()).toMatchObject({
			parseResult: 'error',
			selectedRootBookFilename: 'main.bean'
		});
	});

	test('rejects downloaded infrastructure that would overwrite cashier.bean', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/cashier.bean');
		mockState.opfsFiles.set('cashier.bean', '2026-01-01 * "Local"');

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockResolvedValue(
			new Map([['/workspace/cashier.bean', 'server content']])
		);

		await expect(synchronize({ syncLedgerFiles: true })).resolves.toBe(false);

		expect(mockState.opfsFiles.get('cashier.bean')).toBe('2026-01-01 * "Local"');
		expect(mockState.deleteCache).not.toHaveBeenCalled();
		expect(getLastDiagnostics()).toMatchObject({ parseResult: 'error' });
	});

	test('metadata-only sync records skipped parse diagnostics and writes no files', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');

		vi.spyOn(CashierSyncBeancount.prototype, 'readAccounts').mockResolvedValue({
			rows: [['10', 'USD', 'Assets:Cash']]
		});
		vi.spyOn(CashierSyncBeancount.prototype, 'readPayees').mockResolvedValue(['Shop']);

		await expect(
			synchronize({ syncAccounts: true, syncPayees: true, syncLedgerFiles: false })
		).resolves.toBe(true);

		expect(mockState.opfsFiles.size).toBe(0);
		expect(getLastDiagnostics()).toMatchObject({
			syncMode: 'metadata-only',
			parseResult: 'skipped',
			accountsCount: 1,
			payeesCount: 1
		});
	});

	test('failed include fetch rejects before OPFS writes', async () => {
		mockState.settingsStore.set(SettingKeys.syncServerUrl, 'https://cashier.example.test');
		mockState.settingsStore.set(SettingKeys.syncBeancountRootFile, '/workspace/main.bean');

		vi.spyOn(CashierSyncBeancount.prototype, 'readLedgerFiles').mockRejectedValue(
			new Error('missing /workspace/accounts.bean')
		);

		await expect(synchronize({ syncLedgerFiles: true })).resolves.toBe(false);

		expect(vi.mocked(opfs.saveFile)).not.toHaveBeenCalled();
		expect(getLastDiagnostics()).toMatchObject({ parseResult: 'error' });
	});
});
