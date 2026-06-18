<script lang="ts">
	import type { Xact } from '$lib/data/model';
	import { getAmountColour } from '$lib/utils/formatter';
	import { TriangleAlertIcon } from '@lucide/svelte';

	interface Props {
		xact: Xact;
		onclick?: (xact: Xact) => void;
		isLocal?: boolean;
	}
	let { xact, onclick, isLocal = false }: Props = $props();

	function onRowClicked() {
		if (onclick) {
			onclick(xact);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article onclick={onRowClicked}>
	<!-- date/payee -->
	<div class="flex flex-row space-x-2">
		<time class="opacity-85">
			{xact.date}
			<!-- todo: ISO format -->
		</time>
		<div class="flex items-center gap-1">
			{#if xact.flag === '!'}
				<TriangleAlertIcon class="text-warning size-4 shrink-0" />
			{/if}
			{xact.payee}
			{#if isLocal}
				<span class="badge badge-xs badge-ghost opacity-60">On device</span>
			{/if}
		</div>
	</div>

	<!-- note -->
	{#if xact.note}
		<div class="text-primary pl-6 leading-4">
			<small>; {xact.note}</small>
		</div>
	{/if}

	<!-- postings -->
	{#if xact.postings}
		<div class="pl-6 leading-4">
			{#each xact.postings as posting (posting)}
				<div class="flex flex-row opacity-85">
					<data class="grow text-sm">{posting.account}</data>
					<data class={`${getAmountColour(posting.amount as number)}`}>
						{posting.amount} {posting.currency}</data
					>
				</div>
			{/each}
		</div>
	{/if}
</article>
