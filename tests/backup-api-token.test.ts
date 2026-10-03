import { beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
	settings: [] as Array<{ key: string; value: string }>,
	restored: [] as unknown[]
}));
vi.mock('$lib/settings', () => ({
	SettingKeys: { syncApiToken: 'syncApiToken' },
	settings: {
		getAll: async () => state.settings,
		get: async (key: string) => {
			const row = state.settings.find((s) => s.key === key);
			return row ? JSON.parse(row.value) : undefined;
		}
	}
}));
vi.mock('$lib/data/db', () => ({
	default: {
		settings: {
			clear: vi.fn(),
			bulkAdd: async (rows: unknown[]) => {
				state.restored = rows;
			}
		},
		scheduled: { toArray: async () => [], clear: vi.fn(), bulkAdd: vi.fn() }
	}
}));
import { createBackup, restoreBackup } from '$lib/services/backupService';
beforeEach(() => {
	state.settings = [];
	state.restored = [];
});
test('export excludes device API token but preserves ordinary settings', async () => {
	state.settings = [
		{ key: 'syncApiToken', value: JSON.stringify('private-secret') },
		{ key: 'syncServerUrl', value: JSON.stringify('https://example.test/api') }
	];
	const backup = await createBackup();
	expect(backup).not.toContain('private-secret');
	expect(backup).not.toContain('syncApiToken');
	expect(JSON.parse(backup).settings).toHaveLength(1);
});
test('restore rejects imported token and preserves existing device token', async () => {
	state.settings = [{ key: 'syncApiToken', value: JSON.stringify('device-secret') }];
	await restoreBackup(
		JSON.stringify({
			settings: [{ key: 'syncApiToken', value: JSON.stringify('imported-secret') }],
			scx: []
		})
	);
	expect(state.restored).toEqual([
		expect.objectContaining({ key: 'syncApiToken', value: JSON.stringify('device-secret') })
	]);
});
test('restore cannot inject token into a device without a token', async () => {
	await restoreBackup(
		JSON.stringify({
			settings: [{ key: 'syncApiToken', value: JSON.stringify('imported-secret') }],
			scx: []
		})
	);
	expect(state.restored).toEqual([]);
});
