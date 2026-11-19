import { CASHIER_XACT_FILE } from '#lib/constants';

/** Only a missing file is an empty journal; inaccessible storage is an error. */
export async function readJournal(): Promise<string | undefined> {
	const root = await navigator.storage.getDirectory();
	let handle: FileSystemFileHandle;
	try {
		handle = await root.getFileHandle(CASHIER_XACT_FILE);
	} catch (error) {
		if (
			error !== null &&
			typeof error === 'object' &&
			'name' in error &&
			error.name === 'NotFoundError'
		)
			return undefined;
		throw error;
	}
	return (await handle.getFile()).text();
}

/** Reject observed changes before committing and verify the bytes actually stored. */
export async function saveJournal(expected: string, content: string): Promise<void> {
	const root = await navigator.storage.getDirectory();
	// Preparation/reconciliation only replace an existing journal, never recreate a deleted one.
	const handle = await root.getFileHandle(CASHIER_XACT_FILE);
	const stream = await handle.createWritable();
	try {
		// Opening the writer can itself yield to an editor in another tab.
		if ((await readJournal()) !== expected) {
			throw new Error('Local journal changed during Sync; retry without overwriting local edits.');
		}
		await stream.write(new TextEncoder().encode(content));
		if ((await readJournal()) !== expected) {
			throw new Error('Local journal changed during Sync; retry without overwriting local edits.');
		}
		await stream.close();
	} catch (error) {
		await stream.abort().catch(() => {});
		throw error;
	}
	if ((await readJournal()) !== content) {
		throw new Error(
			'Could not verify the saved local journal; retry Sync before sending or removing entries.'
		);
	}
}
