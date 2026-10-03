import type { Setting } from '$lib/data/model';
/** Backup boundaries must never export or import a device-scoped API credential. */
export function filterBackupSettings<T extends Pick<Setting, 'key' | 'value'>>(entries: T[]): T[] {
	return entries.filter((entry) => entry.key !== 'syncApiToken');
}
export function settingsForRestore<T extends Pick<Setting, 'key' | 'value'>>(
	entries: T[],
	localToken?: T
): T[] {
	const filtered = filterBackupSettings(entries);
	if (localToken) filtered.push(localToken);
	return filtered;
}
