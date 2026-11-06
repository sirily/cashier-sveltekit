import { beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({
	settings: [] as Array<{ key: string; value: string }>,
	scheduled: [] as unknown[]
}));
vi.mock('#lib/settings', () => ({
	settings: {
		getAll: async () => state.settings
	}
}));
vi.mock('#lib/data/db', () => ({
	default: {
		scheduled: { toArray: async () => state.scheduled }
	}
}));
import { createBackup, createBackupFile } from '#lib/services/backupService';

beforeEach(() => {
	state.settings = [];
	state.scheduled = [];
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
test('outbound backup contains only credential-free settings and scheduled payload without mutation', async () => {
	state.settings = [
		{ key: 'syncApiToken', value: '"active-secret"' },
		{ key: 'webdav-settings', value: '{"password":"legacy-password"}' },
		{ key: 'pCloudToken', value: '"legacy-token"' },
		{ key: 'backupServerUrl', value: '"https://retired-backup.test"' },
		{ key: 'syncServers', value: '[{"id":"retained-server"}]' },
		{ key: 'syncActiveServerId', value: '"retained-server"' },
		{ key: 'currency', value: '"USD"' },
		{ key: 'forecast.accounts', value: '["Assets:Cash"]' },
		{ key: 'forecast.days', value: '28' }
	];
	state.scheduled = [{ id: 41, nextDate: '2099-01-15', transaction: { note: 'Keep schedule' } }];
	const before = structuredClone({ settings: state.settings, scheduled: state.scheduled });
	const text = await createBackup();
	expect(JSON.parse(text)).toEqual({ settings: before.settings.slice(4), scx: before.scheduled });
	for (const secret of [
		'syncApiToken',
		'active-secret',
		'legacy-password',
		'legacy-token',
		'retired-backup.test'
	]) {
		expect(text).not.toContain(secret);
	}
	expect({ settings: state.settings, scheduled: state.scheduled }).toEqual(before);
});

test('outbound backup download uses the same filtered settings and scheduled payload', async () => {
	state.settings = [
		{ key: 'syncApiToken', value: '"private-secret"' },
		{ key: 'pCloudToken', value: '"old-secret"' },
		{ key: 'currency', value: '"USD"' }
	];
	state.scheduled = [{ id: 42, remarks: 'Downloaded schedule' }];
	const click = vi.fn();
	const link = { href: '', download: '', click };
	const appendChild = vi.fn();
	const removeChild = vi.fn();
	const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:backup-test');
	const revokeObjectURL = vi.fn();
	vi.stubGlobal('document', {
		createElement: vi.fn(() => link),
		body: { appendChild, removeChild }
	});
	vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
	vi.useFakeTimers();
	try {
		await createBackupFile('local-settings.json');
		const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
		expect(JSON.parse(await blob.text())).toEqual({
			settings: [{ key: 'currency', value: '"USD"' }],
			scx: state.scheduled
		});
		expect(link).toMatchObject({ href: 'blob:backup-test', download: 'local-settings.json' });
		expect(click).toHaveBeenCalledOnce();
		expect(appendChild).toHaveBeenCalledWith(link);
		expect(removeChild).toHaveBeenCalledWith(link);
		vi.runAllTimers();
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup-test');
	} finally {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	}
});
