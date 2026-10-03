import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterBackupSettings, settingsForRestore } from '$lib/services/backupSettings';
test('shared filtering removes token from local or remote settings', () => {
	expect(
		filterBackupSettings([
			{ key: 'syncApiToken', value: 'secret' },
			{ key: 'currency', value: 'USD' }
		])
	).toEqual([{ key: 'currency', value: 'USD' }]);
});
test('shared restore ignores foreign token and preserves local raw setting', () => {
	expect(
		settingsForRestore(
			[
				{ key: 'syncApiToken', value: 'foreign' },
				{ key: 'currency', value: 'USD' }
			],
			{ key: 'syncApiToken', value: 'local' }
		)
	).toEqual([
		{ key: 'currency', value: 'USD' },
		{ key: 'syncApiToken', value: 'local' }
	]);
});
test('shared restore does not inject token when local token absent', () => {
	expect(settingsForRestore([{ key: 'syncApiToken', value: 'foreign' }])).toEqual([]);
});
test('all WebDAV settings export and rendering routes use shared filtering', () => {
	for (const path of [
		'src/routes/backup/webdav/+page.svelte',
		'src/routes/backup/webdav/preview/+page.svelte',
		'src/routes/backup/webdav/diff/+page.svelte'
	]) {
		const code = readFileSync(path, 'utf8');
		expect(code).toContain('filterBackupSettings(await settings.getAll())');
		if (path.includes('preview') || path.includes('diff'))
			expect(code).toContain('filterBackupSettings(JSON.parse(await res.text()))');
	}
	expect(readFileSync('src/routes/backup/webdav/+page.svelte', 'utf8')).toContain(
		'restoreSettings(entries)'
	);
});
