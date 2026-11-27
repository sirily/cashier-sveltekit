/**
 * IndexedDB-backed manifest of files imported from an external directory into
 * OPFS. Stores size + lastModified per imported path so subsequent scans can
 * detect new, modified, or deleted files without hashing content.
 */

export type ImportedFileMeta = {
	path: string;
	size: number;
	lastModified: number;
	importedAt: number;
};

const DB_NAME = 'cashier-import-manifest';
const STORE = 'files';

function openDb(create = true): Promise<IDBDatabase | null> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		let absent = false;
		req.onupgradeneeded = () => {
			if (!create) {
				absent = true;
				req.transaction?.abort();
				return;
			}
			req.result.createObjectStore(STORE, { keyPath: 'path' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => (absent ? resolve(null) : reject(req.error));
	});
}

export async function getManifest(): Promise<Map<string, ImportedFileMeta>> {
	const db = await openDb(false);
	if (db === null) return new Map();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readonly');
		const req = tx.objectStore(STORE).getAll();
		req.onsuccess = () => {
			db.close();
			const map = new Map<string, ImportedFileMeta>();
			for (const entry of req.result as ImportedFileMeta[]) {
				map.set(entry.path, entry);
			}
			resolve(map);
		};
		req.onerror = () => {
			db.close();
			reject(req.error);
		};
	});
}

export async function putManifestEntry(meta: ImportedFileMeta): Promise<void> {
	const db = await openDb();
	if (db === null) throw new Error('Import manifest database unavailable.');
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).put(meta);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function deleteManifestEntry(path: string): Promise<void> {
	const db = await openDb(false);
	if (db === null) return;
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, 'readwrite');
		tx.objectStore(STORE).delete(path);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}
