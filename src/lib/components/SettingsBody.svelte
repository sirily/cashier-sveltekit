<script lang="ts">
	import { readSettingsPreferences } from '#lib/services/settingsPreferences';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';
	import { syncAction } from '#lib/sync/sync-action.svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';

	const request = new ReportRequest<Awaited<ReturnType<typeof readSettingsPreferences>>>();
	const preferences = $derived(request.value);
	const version = fullLedgerService.version;
	const reloading = fullLedgerService.isReloading;

	$effect(() => {
		const runs = syncAction.completedRuns;
		const currentVersion = $version;
		if ($reloading) return;
		void request.run(
			readSettingsPreferences,
			() => runs === syncAction.completedRuns && currentVersion === $version && !$reloading
		);
		return () => request.cancel();
	});
</script>

{#if request.error}
	<p class="p-2" role="alert">Could not read settings: {request.error}</p>
{:else if $reloading || !preferences}
	<p class="p-2" role="status">Loading saved settings…</p>
{:else}
	<dl
		class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-2 p-2 text-sm [&>dd]:wrap-break-word"
	>
		<dt>Book file</dt>
		<dd>{preferences.bookFilename || 'Not set'}</dd>
		<dt>Asset allocation definition</dt>
		<dd>{preferences.assetAllocationDefinition || 'Not set'}</dd>
		<dt>Investment account root</dt>
		<dd>{preferences.rootInvestmentAccount || 'Not set'}</dd>
		<dt>Main Currency</dt>
		<dd>{preferences.currency || 'Not set'}</dd>
		<dt>Date Format</dt>
		<dd>{preferences.dateFormat}</dd>
		<dt>Remember last transaction</dt>
		<dd>{preferences.rememberLastTransaction ? 'On' : 'Off'}</dd>
		<dt>Ledger caching</dt>
		<dd>{preferences.ledgerCacheEnabled ? 'On' : 'Off'}</dd>
	</dl>
{/if}
