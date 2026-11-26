<script lang="ts">
	import { onMount } from 'svelte';
	import { readSettingsPreferences } from '#lib/services/settingsPreferences';

	let preferences = $state<Awaited<ReturnType<typeof readSettingsPreferences>>>();
	let error = $state('');

	onMount(() => {
		let active = true;
		void readSettingsPreferences().then(
			(result) => {
				if (active) preferences = result;
			},
			(reason: unknown) => {
				if (active) error = reason instanceof Error ? reason.message : String(reason);
			}
		);
		return () => {
			active = false;
		};
	});
</script>

{#if error}
	<p class="p-2" role="alert">Could not read settings: {error}</p>
{:else if !preferences}
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
