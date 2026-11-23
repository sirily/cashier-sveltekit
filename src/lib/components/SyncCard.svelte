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
		<div class="flex flex-wrap items-center justify-between gap-2 px-2">
			<p>Send completed entries and download the latest server book.</p>
			<a href={resolve('/sync')} class="btn btn-ghost btn-sm">
				<SettingsIcon size={16} />
				<span>Sync settings</span>
			</a>
		</div>
	{/snippet}
</CardTemplate>
