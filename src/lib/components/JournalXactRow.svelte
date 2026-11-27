<script lang="ts">
	import type { Xact } from '#lib/data/model';
	import {
		formatAmount,
		getAmountColour,
		getReadableDate,
		getXactAmountColour
	} from '#lib/utils/formatter';
	import { XactAugmenter } from '#lib/utils/xactAugmenter';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	interface Props {
		xact: Xact;
		onclick?: (xact: Xact) => void;
		isLocal?: boolean;
		compact?: boolean;
	}
	let { xact, onclick, isLocal = false, compact = false }: Props = $props();
	const summary = $derived(
		compact
			? XactAugmenter.calculateXactAmounts([
					{ ...xact, postings: xact.postings.map((posting) => ({ ...posting })) }
				])[0]
			: undefined
	);

	function onRowClicked() {
		if (onclick) {
			onclick(xact);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<article onclick={onRowClicked} class={compact ? 'border-base-content/15 border-b' : undefined}>
	<div class="flex flex-wrap gap-x-2">
		<time class={compact ? 'opacity-60' : 'opacity-85'} datetime={xact.date}>
			{compact ? getReadableDate(xact.date ?? '') : xact.date}
		</time>
		<div class="flex min-w-0 grow items-center gap-1 break-words">
			{#if xact.flag === '!'}
				<TriangleAlertIcon
					class="text-warning size-4 shrink-0"
					aria-label="Incomplete entry"
					role="img"
				/>
			{/if}
			{compact ? xact.payee || xact.note || 'Unnamed entry' : xact.payee}
			{#if isLocal}
				<span class="badge badge-xs badge-ghost opacity-60">On device</span>
			{/if}
		</div>
		{#if summary}
			<data class={summary.quantity ? getXactAmountColour(xact, summary) : ''}>
				{formatAmount(summary.quantity)}
				{summary.currency}
			</data>
		{/if}
	</div>

	{#if !compact && xact.note}
		<div class="text-primary pl-6 leading-4">
			<small>; {xact.note}</small>
		</div>
	{/if}

	<!-- postings -->
	{#if !compact && xact.postings}
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
