<script lang="ts">
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { computeSourceHash, ensureInitialized } from '#lib/services/rustledger';
	import { settings, SettingKeys } from '#lib/settings';
	import { listFileTree } from '#lib/utils/opfslib';
	import { OPFSBackend } from '#lib/storage';
	import SerializationBody from '#lib/components/SerializationBody.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';

	let details = $state<ReturnType<typeof SerializationBody>>();
	let status = $state('');
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let currentHash = $state('');
	let isWorking = $state(false);

	async function handleLoad() {
		loading = true;
		loadError = null;
		try {
			await fullLedgerService.load();
			await details?.refresh();
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	async function handleSerialize() {
		isWorking = true;
		status = 'Loading ledger...';
		try {
			await fullLedgerService.ensureLoaded();

			status = 'Serializing...';
			const result = await fullLedgerService.serialize();

			// Compute hash from source files and persist it
			const fileMap = await loadOpfsFileMap();
			currentHash = await hashFileMap(fileMap);
			await settings.set(SettingKeys.ledgerCacheHash, currentHash);

			status = `Serialized ${result.bytes.toLocaleString()} bytes to OPFS. Hash saved.`;
			await details?.refresh();
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleDeserialize() {
		isWorking = true;
		status = 'Restoring from cache...';
		try {
			const result = await fullLedgerService.loadFromCache();

			// Hash comparison
			const fileMap = await loadOpfsFileMap();
			currentHash = await hashFileMap(fileMap);
			const storedHash = await settings.get<string>(SettingKeys.ledgerCacheHash);
			const hashMatch = storedHash && currentHash === storedHash;

			status = `Restored from cache (${result.directiveCount} directives). Hash ${hashMatch ? 'matches' : 'mismatch — sources may have changed'}.`;
			await details?.refresh();
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function handleCalculateHash() {
		isWorking = true;
		status = 'Reading OPFS files...';
		try {
			const fileMap = await loadOpfsFileMap();
			currentHash = await hashFileMap(fileMap);
			status = `Hash calculated from ${Object.keys(fileMap).length} source file(s).`;
		} catch (e) {
			status = `Error: ${e}`;
		} finally {
			isWorking = false;
		}
	}

	async function clearLedger(action: () => Promise<void>, message: string) {
		isWorking = true;
		try {
			await action();
			loadError = null;
			currentHash = '';
			status = message;
			await details?.refresh();
		} catch (error) {
			status = 'Error: ' + String(error);
		} finally {
			isWorking = false;
		}
	}

	const handleReset = () =>
		clearLedger(() => fullLedgerService.reset(), 'Ledger instance freed (not loaded).');
	const handleDeleteCache = () =>
		clearLedger(() => fullLedgerService.deleteCache(), 'Cache deleted and ledger instance freed.');

	async function loadOpfsFileMap(): Promise<Record<string, string>> {
		const opfs = new OPFSBackend();
		const tree = await listFileTree();
		const beanEntries = tree.filter((e) => e.kind === 'file' && e.name.endsWith('.bean'));

		const fileMap: Record<string, string> = {};
		await Promise.all(
			beanEntries.map(async (entry) => {
				const content = await opfs.readFile(entry.path);
				if (content !== undefined) {
					fileMap[entry.path] = content;
				}
			})
		);
		return fileMap;
	}

	async function hashFileMap(fileMap: Record<string, string>): Promise<string> {
		await ensureInitialized();
		const sources = Object.keys(fileMap)
			.sort()
			.map((k) => fileMap[k]);
		return computeSourceHash(sources);
	}
</script>

<Toolbar title="Ledger Serialization" />
<article class="max-w-xl p-4">
	<SerializationBody bind:this={details} {loading} {loadError} {currentHash}>
		{#snippet ledgerActions()}
			<div class="mt-2 flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-sm"
					onclick={handleLoad}
					disabled={loading || isWorking}>Load</button
				>
				<button
					type="button"
					class="btn btn-primary btn-sm"
					onclick={handleSerialize}
					disabled={loading || isWorking}>Serialize → OPFS</button
				>
				<button
					type="button"
					class="btn btn-outline btn-sm"
					onclick={handleReset}
					disabled={loading || isWorking}>Reset instance</button
				>
			</div>
		{/snippet}
		{#snippet cacheActions(hasCache)}
			<div class="mt-2 flex flex-wrap gap-2">
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					onclick={handleDeserialize}
					disabled={loading || isWorking || !hasCache}>Deserialize ← OPFS</button
				>
				<button
					type="button"
					class="btn btn-outline btn-sm"
					onclick={handleCalculateHash}
					disabled={loading || isWorking}>Calculate hash</button
				>
				<button
					type="button"
					class="btn btn-outline btn-error btn-sm"
					onclick={handleDeleteCache}
					disabled={loading || isWorking}>Delete cache</button
				>
			</div>
		{/snippet}
	</SerializationBody>
	{#if status}<p role="status" class="alert alert-soft py-2 text-sm">{status}</p>{/if}
</article>
