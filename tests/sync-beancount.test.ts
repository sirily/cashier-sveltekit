import { describe, expect, test, vi } from 'vitest';

vi.mock('$lib/utils/notifier', () => ({
	default: {
		init: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}));

import { CashierSyncBeancount, __test__ } from '$lib/sync/sync-beancount';

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
});

describe('CashierSyncBeancount ledger file download', () => {
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
});
