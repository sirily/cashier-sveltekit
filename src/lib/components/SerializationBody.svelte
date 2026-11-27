<script lang="ts">
	import type { Snippet } from 'svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { settings, SettingKeys } from '#lib/settings';
	import { getFileMetadata } from '#lib/utils/opfslib';
	import { LEDGER_CACHE_FILE } from '#lib/constants';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';

	let {
		loading = false,
		loadError = null,
		currentHash = '',
		ledgerActions,
		cacheActions
	}: {
		loading?: boolean;
		loadError?: string | null;
		currentHash?: string;
		ledgerActions?: Snippet;
		cacheActions?: Snippet<[hasCache: boolean]>;
	} = $props();

	const loaded = fullLedgerService.loaded;
	const version = fullLedgerService.version;
	const reloading = fullLedgerService.isReloading;
	const request = new ReportRequest<{
		count: number | null;
		cacheSize: number | null;
		hash: string;
	}>();
	const pending = $derived(request.pending || loading || $reloading);
	const hashState = $derived(
		!request.value?.hash || !currentHash
			? 'unknown'
			: request.value.hash === currentHash
				? 'match'
				: 'mismatch'
	);

	$effect(() => {
		const currentVersion = $version;
		const isLoaded = $loaded;
		if ($reloading) return;
		void refresh(currentVersion, isLoaded);
		return () => request.cancel();
	});

	export async function refresh(currentVersion = $version, isLoaded = $loaded) {
		await request.run(
			async () => {
				const [directives, meta, hash] = await Promise.all([
					isLoaded ? fullLedgerService.getDirectives() : Promise.resolve(null),
					getFileMetadata(LEDGER_CACHE_FILE),
					settings.get<string>(SettingKeys.ledgerCacheHash)
				]);
				return {
					count: directives?.length ?? null,
					cacheSize: meta?.size ?? null,
					hash: hash ?? ''
				};
			},
			() => currentVersion === $version && isLoaded === $loaded && !$reloading
		);
	}

	export function storedHash() {
		return request.value?.hash ?? '';
	}

	function shortHash(hash: string) {
		return hash ? hash.slice(0, 12) + '…' : '—';
	}
</script>

<div class="space-y-4 p-2">
	<section>
		<h3 class="mb-2 text-base font-semibold">Ledger Instance</h3>
		{#if loadError || request.error}
			<p role="alert">Could not read ledger status: {loadError ?? request.error}</p>
		{:else if pending}
			<p role="status">Reading ledger status…</p>
		{:else}
			<p>
				{request.value?.count != null
					? 'Ledger loaded (' + request.value.count + ' directives)'
					: 'Ledger not loaded'}
			</p>
		{/if}
		{#if ledgerActions}{@render ledgerActions()}{/if}
	</section>
	<section>
		<h3 class="mb-2 text-base font-semibold">OPFS Cache</h3>
		<dl class="bg-base-200 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded p-3 text-sm">
			<dt>Cache size</dt>
			<dd>
				{request.value?.cacheSize != null
					? request.value.cacheSize.toLocaleString() + ' bytes'
					: '—'}
			</dd>
			<dt>Stored hash</dt>
			<dd class="font-mono">{shortHash(storedHash())}</dd>
			{#if cacheActions}
				<dt>Current hash</dt>
				<dd>
					<span class="font-mono">{shortHash(currentHash)}</span>
					<span
						class="badge badge-sm {hashState === 'match'
							? 'badge-success'
							: hashState === 'mismatch'
								? 'badge-error'
								: 'badge-ghost'}">{hashState}</span
					>
				</dd>
			{/if}
		</dl>
		{#if cacheActions}{@render cacheActions(request.value?.cacheSize != null)}{/if}
	</section>
</div>
