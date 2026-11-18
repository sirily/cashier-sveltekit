<script lang="ts">
	import { needRefresh, offlineReady, updateApp } from '#lib/services/pwaUpdate.svelte';

	const toast = $derived(offlineReady.value || needRefresh.value);

	function close() {
		offlineReady.value = false;
		needRefresh.value = false;
	}
</script>

{#if toast}
	<!-- Leave room below the prompt for fixed action buttons such as Journal Save. -->
	<div class="toast toast-end bottom-24 z-50">
		<div class="alert alert-info shadow-lg flex flex-row gap-4 items-center">
			<div class="min-w-0 flex-1 whitespace-normal">
				{#if needRefresh.value}
					<span>New content available, click reload to update.</span>
				{:else}
					<span>App ready to work offline</span>
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
