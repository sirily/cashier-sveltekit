import { expect, test } from 'vitest';

import { filterBackupSettings } from '#lib/services/backupSettings';
test('outbound filtering removes active and retired credentials without changing source settings', () => {
	const retained = [
		{ key: 'currency', value: 'USD' },
		{ key: 'syncServerUrl', value: 'https://server.test/api' },
		{ key: 'syncServers', value: '[{"id":"server"}]' },
		{ key: 'syncActiveServerId', value: 'server' },
		{ key: 'userBookFilename', value: 'server.bean' },
		{ key: 'unrelatedTokenPreference', value: 'keep' }
	];
	const entries = [
		{ key: 'syncApiToken', value: 'active-secret' },
		{ key: 'webdav-settings', value: '{"password":"legacy-password"}' },
		{ key: 'pCloudToken', value: 'legacy-token' },
		{ key: 'backupServerUrl', value: 'https://retired-backup.test' },
		...retained
	];
	const before = structuredClone(entries);
	expect(filterBackupSettings(entries)).toEqual(retained);
	expect(entries).toEqual(before);
	expect(filterBackupSettings(filterBackupSettings(entries))).toEqual(retained);
});
