import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
	rows: new Map<string, { key: string; value: string }>(),
	bulkDelete: vi.fn<(...args: [string[]]) => Promise<void>>()
}));
vi.mock('#lib/data/db', () => ({
	default: {
		settings: {
			bulkDelete: state.bulkDelete,
			get: async (key: string) => state.rows.get(key),
			toArray: async () => [...state.rows.values()]
		}
	}
}));

const retained = [
	{ key: 'syncApiToken', value: '"active-device-secret"' },
	{ key: 'syncServerUrl', value: '"https://server.test/api"' },
	{ key: 'syncServers', value: '[{"id":"server","url":"https://server.test/api"}]' },
	{ key: 'syncActiveServerId', value: '"server"' },
	{ key: 'syncServerSelectionCleared', value: 'false' },
	{ key: 'syncBeancountRootFile', value: '"main.bean"' },
	{ key: 'userBookFilename', value: '"server.bean"' },
	{ key: 'ledgerDataSource', value: '"filesystem"' },
	{ key: 'homeCardNames', value: '["JournalCard","SyncCard"]' },
	{ key: 'currency', value: '"USD"' },
	{ key: 'unrelatedTokenPreference', value: 'keep raw value' }
];
const retired = [
	{
		key: 'webdav-settings',
		value: '{"url":"https://retired-backup.test","password":"old-secret"}'
	},
	{ key: 'pCloudToken', value: 'old-cloud-token' },
	{ key: 'backupServerUrl', value: 'https://retired-backup.test' }
];

beforeEach(() => {
	vi.resetModules();
	state.rows = new Map([...retained, ...retired].map((row) => [row.key, { ...row }]));
	state.bulkDelete.mockReset();
	state.bulkDelete.mockImplementation(async (keys) => {
		for (const key of keys) state.rows.delete(key);
	});
});

test('settings load purges exactly the legacy remote keys locally and preserves every other raw row', async () => {
	const fetch = vi.fn();
	vi.stubGlobal('fetch', fetch);
	try {
		const { settings } = await import('#lib/settings');
		expect(await settings.get('syncApiToken')).toBe('active-device-secret');
		expect(await settings.getAll()).toEqual(retained);
		expect(await settings.get('webdav-settings')).toBeNull();
		expect(await settings.get('pCloudToken')).toBeNull();
		expect(await settings.get('backupServerUrl')).toBeNull();
		expect(state.bulkDelete).toHaveBeenCalledExactlyOnceWith([
			'webdav-settings',
			'pCloudToken',
			'backupServerUrl'
		]);
		expect([...state.rows.values()]).toEqual(retained);
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});

test('getAll is also a migration boundary and concurrent settings reads share cleanup', async () => {
	const { settings } = await import('#lib/settings');
	const [rows, currency] = await Promise.all([settings.getAll(), settings.get('currency')]);
	expect(rows).toEqual(retained);
	expect(currency).toBe('USD');
	expect(state.bulkDelete).toHaveBeenCalledTimes(1);
});

test('cleanup on another session is repeatable without deleting any retained settings', async () => {
	const first = await import('#lib/settings');
	await first.settings.getAll();
	vi.resetModules();
	const second = await import('#lib/settings');
	expect(await second.settings.getAll()).toEqual(retained);
	expect(state.bulkDelete).toHaveBeenCalledTimes(2);
});

test('fresh settings stay empty without inventing server configuration or credentials', async () => {
	state.rows.clear();
	const { settings } = await import('#lib/settings');
	expect(await settings.getAll()).toEqual([]);
	expect(await settings.get('syncApiToken')).toBeNull();
	expect(await settings.get('syncServerUrl')).toBeNull();
});

test('failed local cleanup hides retired rows, preserves retained reads and retries on the next load', async () => {
	state.bulkDelete.mockRejectedValueOnce(new Error('Storage unavailable'));
	const { settings } = await import('#lib/settings');
	expect(await settings.getAll()).toEqual(retained);
	expect([...state.rows.values()]).toEqual([...retained, ...retired]);
	expect(await settings.get('syncApiToken')).toBe('active-device-secret');
	expect(state.bulkDelete).toHaveBeenCalledTimes(2);
	expect([...state.rows.values()]).toEqual(retained);
});

test('persistent deletion failures cannot expose retired keys or block retained settings reads', async () => {
	state.bulkDelete.mockRejectedValue(new Error('Deletion unavailable'));
	const { settings } = await import('#lib/settings');
	for (const { key } of retired) expect(await settings.get(key)).toBeNull();
	expect(await settings.get('syncApiToken')).toBe('active-device-secret');
	expect(await settings.get('syncServerUrl')).toBe('https://server.test/api');
	expect(await settings.get('userBookFilename')).toBe('server.bean');
	expect(await settings.getAll()).toEqual(retained);
	expect([...state.rows.values()]).toEqual([...retained, ...retired]);
	for (const [keys] of state.bulkDelete.mock.calls) {
		expect(keys).toEqual(['webdav-settings', 'pCloudToken', 'backupServerUrl']);
	}
});

test('concurrent initialization reads survive a shared cleanup failure and retry together', async () => {
	let rejectCleanup!: (reason: Error) => void;
	state.bulkDelete.mockImplementationOnce(
		() =>
			new Promise<void>((_, reject) => {
				rejectCleanup = reject;
			})
	);
	const { settings } = await import('#lib/settings');
	const initialization = Promise.all([
		settings.get('userBookFilename'),
		settings.get('syncApiToken'),
		settings.get('syncServers'),
		settings.get('webdav-settings'),
		settings.getAll()
	]);
	expect(state.bulkDelete).toHaveBeenCalledTimes(1);
	rejectCleanup(new Error('Cleanup unavailable during initialization'));
	expect(await initialization).toEqual([
		'server.bean',
		'active-device-secret',
		[{ id: 'server', url: 'https://server.test/api' }],
		null,
		retained
	]);
	expect([...state.rows.values()]).toEqual([...retained, ...retired]);
	expect(await Promise.all([settings.getAll(), settings.get('syncApiToken')])).toEqual([
		retained,
		'active-device-secret'
	]);
	expect(state.bulkDelete).toHaveBeenCalledTimes(2);
	expect([...state.rows.values()]).toEqual(retained);
});
