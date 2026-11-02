import type { Setting } from '#lib/data/model';
import { retiredRemoteSettingKeys } from '#lib/retiredRemoteSettings';

const excludedKeys = new Set<string>(['syncApiToken', ...retiredRemoteSettingKeys]);

/** Backup boundaries exclude device credentials and retired remote-backup settings. */
export function filterBackupSettings<T extends Pick<Setting, 'key' | 'value'>>(entries: T[]): T[] {
	return entries.filter((entry) => !excludedKeys.has(entry.key));
}
export function settingsForRestore<T extends Pick<Setting, 'key' | 'value'>>(
	entries: T[],
	localToken?: T
): T[] {
	const filtered = filterBackupSettings(entries);
	if (localToken) filtered.push(localToken);
	return filtered;
}
