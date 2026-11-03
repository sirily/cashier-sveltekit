/** Commit existing source text through OPFS's temporary writer; never swallow storage errors. */
export async function writeSourceFile(path: string, content: string): Promise<void> {
	let directory = await navigator.storage.getDirectory();
	const parts = path.split('/');
	const name = parts.pop()!;
	for (const part of parts) directory = await directory.getDirectoryHandle(part);
	const handle = await directory.getFileHandle(name);
	const writer = await handle.createWritable();
	try {
		await writer.write(new TextEncoder().encode(content));
		await writer.close();
	} catch (error) {
		// Abort releases the temporary writer without committing partial text. Keep the original cause.
		await writer.abort().catch(() => {});
		throw error;
	}
}
