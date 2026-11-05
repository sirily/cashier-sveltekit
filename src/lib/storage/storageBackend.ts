/**
 * File operations provided by the OPFS storage backend.
 */
export interface StorageBackend {
	readFile(filename: string): Promise<string | undefined>;
	writeFile(filename: string, content: string): Promise<void>;
	listFiles(): Promise<string[]>;
	lastModified(filename: string): Promise<number | undefined>;
}
