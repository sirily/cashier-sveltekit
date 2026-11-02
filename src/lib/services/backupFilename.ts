import moment from 'moment';
import { BackupType, PtaSystems } from '#lib/enums';
import { ISODATEFORMAT, LONGTIMEFORMAT } from '#lib/constants';

export function getFilenameForBackup(backupType: string) {
	const prefix = backupType.toLowerCase();

	// date/time
	const now = moment();
	const date = now.format(ISODATEFORMAT);
	const time = now.format(LONGTIMEFORMAT);

	// file extension
	let extension;
	switch (backupType) {
		case BackupType.JOURNAL:
			extension = PtaSystems.ledger;
			break;
		default:
			extension = 'json';
			break;
	}

	return `${prefix}_${date}_${time}.${extension}`;
}
