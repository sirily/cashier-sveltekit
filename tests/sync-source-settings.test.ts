import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
	rows: new Map<string, { key: string; value: string }>(),
	put: vi.fn(),
	pickDirectory: vi.fn(),
	bulkDelete: vi.fn<(...args: [string[]]) => Promise<void>>()
}));
vi.mock('#lib/data/db', () => ({
	default: {
		settings: {
			get: async (key: string) => state.rows.get(key),
			toArray: async () => [...state.rows.values()],
			put: state.put,
			bulkDelete: state.bulkDelete
		}
	}
}));

const retained = {
	syncServerUrl: 'https://server.test/api',
	syncApiToken: 'test-only-active-token',
	syncBeancountRootFile: '/workspace/books/personal.bean',
	syncServers: [
		{ id: 'active', name: 'Personal', url: 'https://server.test/api' },
		{ id: 'other', name: 'Other', url: 'https://other.test/api' }
	],
	syncActiveServerId: 'active',
	syncServerSelectionCleared: false,
	syncAccounts: true,
	syncPayees: false,
	syncLedgerFiles: false,
	syncOpeningBalances: true,
	syncAaValues: true,
	syncAssetAllocation: true,
	userBookFilename: 'downloaded.bean',
	'aa.definition': 'allocation.toml',
	currency: 'USD',
	importBookDirectory: 'old-directory',
	importBookFileSpec: '*.bean'
};

beforeEach(() => {
	vi.resetModules();
	state.rows = new Map(
		Object.entries(retained).map(([key, value]) => [key, { key, value: JSON.stringify(value) }])
	);
	state.put.mockReset();
	state.bulkDelete.mockReset();
	state.bulkDelete.mockResolvedValue();
	vi.stubGlobal('fetch', vi.fn());
	state.pickDirectory.mockReset();
	vi.stubGlobal('showDirectoryPicker', state.pickDirectory);
});

afterEach(() => vi.unstubAllGlobals());

for (const source of ['filesystem', 'ledger']) {
	for (const value of [source, JSON.stringify(source)]) {
		test(`read normalizes recognized legacy source ${value} without changing configuration`, async () => {
			state.rows.set('ledgerDataSource', { key: 'ledgerDataSource', value });
			const before = [...state.rows.values()].map((row) => ({ ...row }));
			const { settings } = await import('#lib/settings');
			expect(await settings.get('ledgerDataSource')).toBe('beancount');
			expect(await settings.get('ledgerDataSource')).toBe('beancount');
			for (const [key, expected] of Object.entries(retained)) {
				expect(await settings.get(key)).toEqual(expected);
			}
			// Raw outbound settings remain a faithful snapshot; normalization is read-only.
			expect(await settings.getAll()).toEqual(before);
			expect([...state.rows.values()]).toEqual(before);
			expect(state.put).not.toHaveBeenCalled();
			expect(state.bulkDelete).toHaveBeenCalledExactlyOnceWith([
				'webdav-settings',
				'pCloudToken',
				'backupServerUrl'
			]);
			expect(fetch).not.toHaveBeenCalled();
			expect(state.pickDirectory).not.toHaveBeenCalled();
			vi.resetModules();
			const reloaded = await import('#lib/settings');
			expect(await reloaded.settings.get('ledgerDataSource')).toBe('beancount');
			expect([...state.rows.values()]).toEqual(before);
		});
	}
}

test('fresh settings default to Beancount without inventing connection details, choices or writes', async () => {
	state.rows.clear();
	const { settings } = await import('#lib/settings');
	expect(await settings.get('ledgerDataSource')).toBe('beancount');
	for (const key of [
		'syncServerUrl',
		'syncApiToken',
		'syncBeancountRootFile',
		'syncServers',
		'syncActiveServerId',
		'syncLedgerFiles',
		'syncAccounts',
		'syncPayees'
	]) {
		expect(await settings.get(key)).toBeNull();
	}
	expect(await settings.getAll()).toEqual([]);
	expect(state.put).not.toHaveBeenCalled();
	expect(fetch).not.toHaveBeenCalled();
	expect(state.pickDirectory).not.toHaveBeenCalled();
});

test('partial configuration retains server selections and metadata-only choices without a URL or token', async () => {
	state.rows.delete('syncServerUrl');
	state.rows.delete('syncApiToken');
	const before = [...state.rows.values()].map((row) => ({ ...row }));
	const { settings } = await import('#lib/settings');
	expect(await settings.get('ledgerDataSource')).toBe('beancount');
	expect(await settings.get('syncServerUrl')).toBeNull();
	expect(await settings.get('syncApiToken')).toBeNull();
	expect(await settings.get('syncServers')).toEqual(retained.syncServers);
	expect(await settings.get('syncActiveServerId')).toBe('active');
	expect(await settings.get('syncLedgerFiles')).toBe(false);
	expect(await settings.get('syncAccounts')).toBe(true);
	expect(await settings.getAll()).toEqual(before);
	expect(state.put).not.toHaveBeenCalled();
	expect(fetch).not.toHaveBeenCalled();
});

for (const source of ['beancount', 'unknown-source', '', null]) {
	test(`does not reinterpret an unrecognized or current stored source ${JSON.stringify(source)}`, async () => {
		state.rows.set('ledgerDataSource', { key: 'ledgerDataSource', value: JSON.stringify(source) });
		const { settings } = await import('#lib/settings');
		expect(await settings.get('ledgerDataSource')).toBe(source);
		expect(state.put).not.toHaveBeenCalled();
	});
}
