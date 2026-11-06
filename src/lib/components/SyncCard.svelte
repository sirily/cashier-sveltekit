<script>
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import CardTemplate from './HomeCardTemplate.svelte';
	import { resolve } from '$app/paths';
</script>

<CardTemplate>
	{#snippet icon()}
		<RefreshCwIcon />
	{/snippet}
	{#snippet title()}
		Server Sync
	{/snippet}
	{#snippet content()}
		<p>
			Explicitly send completed entries, pull the server book, and reconcile confirmed local copies.
		</p>
	{/snippet}
	{#snippet footer()}
		<center>
			<a href={resolve('/sync')} class="btn btn-outline btn-warning uppercase rounded">
				<span><SettingsIcon /></span>
				<span>Server Sync</span>
			</a>
		</center>
	{/snippet}
</CardTemplate>
