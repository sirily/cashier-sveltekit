/*
    Backup Service
	Export settings and scheduled transactions as JSON.
*/

import { ISODATEFORMAT, LONGTIMEFORMAT } from '#lib/constants';
import db from '#lib/data/db';
import type { Setting, ScheduledTransaction } from '#lib/data/model';
import { settings } from '#lib/settings';
import { filterBackupSettings } from '#lib/services/backupSettings';
import moment from 'moment';

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
