<script lang="ts">
	import AboutBody from '#lib/components/AboutBody.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import {
		checkForUpdate,
		needRefresh,
		updateApp,
		type UpdateCheckResult
	} from '#lib/services/pwaUpdate.svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	let checking = $state(false);
	let updateResult = $state<UpdateCheckResult | undefined>(undefined);

	async function checkForUpdates() {
		checking = true;
		updateResult = undefined;
		try {
			updateResult = await checkForUpdate();
		} finally {
			checking = false;
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="About" />
	<AboutBody>
		{#snippet updates()}
			<p>
				<button
					class="link link-primary inline-flex items-center gap-1"
					onclick={checkForUpdates}
					disabled={checking}
				>
					<RefreshCw size={14} class={checking ? 'animate-spin' : ''} />
					{checking ? 'Checking…' : 'Check for updates'}
				</button>
			</p>
			{#if updateResult === 'latest' && !needRefresh.value}
				<p>You are on the latest version.</p>
			{:else if updateResult === 'available' || needRefresh.value}
				<p>A new version is available.</p>
				<button class="btn btn-sm btn-primary" onclick={updateApp}>Update</button>
			{:else if updateResult === 'unavailable'}
				<p>Update checking is unavailable.</p>
			{:else if updateResult === 'error'}
				<p>Could not check for updates.</p>
			{/if}
		{/snippet}
	</AboutBody>
</article>
