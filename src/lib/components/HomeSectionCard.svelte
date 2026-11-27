<script lang="ts">
	import { resolve } from '$app/paths';
	import type { HomeCardOption } from '#lib/navigation';
	import HomeCardTemplate from './HomeCardTemplate.svelte';

	let { card }: { card: HomeCardOption } = $props();
	const body = $derived(card.loadBody());
</script>

<HomeCardTemplate>
	{#snippet icon()}
		<card.Icon class="shrink-0" aria-hidden="true" />
	{/snippet}
	{#snippet title()}
		<span role="heading" aria-level="2">
			<a href={resolve(card.path)} class="hover:underline">{card.title}</a>
		</span>
	{/snippet}
	{#snippet content()}
		<div class="max-h-[min(65dvh,36rem)] min-w-0 overflow-auto px-1">
			<svelte:boundary>
				{#await body}
					<p role="status">Loading {card.label}…</p>
				{:then { default: Body }}
					<Body />
				{:catch}
					<p role="alert">Could not load {card.label}.</p>
				{/await}
				{#snippet failed()}
					<p role="alert">Could not display {card.label}.</p>
				{/snippet}
			</svelte:boundary>
		</div>
	{/snippet}
</HomeCardTemplate>
