<script lang="ts">
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '#lib/settings';
	import { parseSyncServerUrl } from '#lib/sync/sync-action.svelte';
	import SyncStatus from './SyncStatus.svelte';

	let configuration = $state<{ validUrl: boolean; hasToken: boolean }>();
	let failed = $state(false);

	onMount(() => {
		let active = true;
		void Promise.all([
			settings.get<string>(SettingKeys.syncServerUrl),
			settings.get<string>(SettingKeys.syncApiToken)
		]).then(
			([url, token]) => {
				if (active)
					configuration = {
						validUrl: Boolean(parseSyncServerUrl(url ?? '')),
						hasToken: Boolean(token?.trim())
					};
			},
			() => {
				if (active) failed = true;
			}
		);
		return () => {
			active = false;
		};
	});
</script>

<div class="space-y-3 p-2">
	{#if failed}
		<p role="alert">Could not read server configuration.</p>
	{:else if !configuration}
		<p role="status">Loading server configuration…</p>
	{:else}
		<p>
			{!configuration.validUrl
				? 'Server URL is not configured.'
				: configuration.hasToken
					? 'Server connection is configured.'
					: 'Server URL is configured; no API token is saved.'}
		</p>
		<SyncStatus />
	{/if}
</div>
