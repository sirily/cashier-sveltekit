<script lang="ts">
	import { needRefresh, offlineReady, updateApp } from '#lib/services/pwaUpdate.svelte';

	const toast = $derived(offlineReady.value || needRefresh.value);

	function close() {
		offlineReady.value = false;
		needRefresh.value = false;
	}
</script>

{#if toast}
	<div class="toast toast-bottom toast-end z-50">
		<div class="alert alert-info shadow-lg flex flex-row gap-4 items-center">
			<div class="flex-1">
				{#if offlineReady.value}
					<span>App ready to work offline</span>
				{:else}
					<span>New content available, click reload to update.</span>
				{/if}
			</div>
			<div class="flex-none flex gap-2">
				{#if needRefresh.value}
					<button class="btn btn-sm btn-primary" onclick={updateApp}>Reload</button>
				{/if}
				<button class="btn btn-sm btn-ghost" onclick={close}>Close</button>
			</div>
		</div>
	</div>
{/if}
