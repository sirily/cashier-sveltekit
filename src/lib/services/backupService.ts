/*
    Backup Service
	Backup and restore custom data using a JSON file.
*/

import { ISODATEFORMAT, LONGTIMEFORMAT } from '$lib/constants';
import db from '$lib/data/db';
import { Setting, type ScheduledTransaction } from '$lib/data/model';
import { SettingKeys, settings } from '$lib/settings';
import { filterBackupSettings, settingsForRestore } from '$lib/services/backupSettings';
import moment from 'moment';

export async function restoreSettings(entries: Setting[]) {
	const existingApiToken = await settings.get<string>(SettingKeys.syncApiToken);
	const localToken = existingApiToken
		? new Setting(SettingKeys.syncApiToken, JSON.stringify(existingApiToken))
		: undefined;
	const restored = settingsForRestore(entries, localToken);
	await db.settings.clear();
	await db.settings.bulkAdd(restored);
}

interface Backup {
	settings: Setting[];
	scx: Array<ScheduledTransaction>;
}

export function getBackupFilename(): string {
	// filename
	const now = moment();
	const date = now.format(ISODATEFORMAT);
	const time = now.format(LONGTIMEFORMAT);
	const filename = `cashier-backup_${date}_${time}.json`;

	return filename;
}

/**
 * Generates backup file and sends it via download.
 */
export async function createBackupFile(filename: string) {
	const output: string = await createBackup();

	downloadTextFile(output, filename);
}

/**
 * Create backup content as text.
 * @returns Text containing the backup content.
 */
export async function createBackup() {
	// assemble the backup content:
	// settings
	const allSettings = filterBackupSettings(await settings.getAll());
	// scheduled transactions
	const scx: ScheduledTransaction[] = await db.scheduled.toArray();

	const backup: Backup = {
		settings: allSettings,
		scx: scx
	};

	const output = JSON.stringify(backup);
	return output;
}

function downloadTextFile(content: string, fileName: string) {
	const blob = new Blob([content], { type: 'text/plain' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = fileName;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	// Clean up
	setTimeout(() => {
		URL.revokeObjectURL(url);
	}, 1500);
}

/**
 * Restores the backup, deleting any existing data.
 * @param content JSON contents of the backup file
 */
export async function restoreBackup(content: string) {
	const backup: Backup = JSON.parse(content);
	await restoreSettings(backup.settings);

	// backup.scx
	await db.scheduled.clear();
	await db.scheduled.bulkAdd(backup.scx);
}
