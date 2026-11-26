<script lang="ts">
	import { homeCardOptions, type HomeCardOption } from '#lib/navigation';
	import HomeSectionCard from './HomeSectionCard.svelte';

	let {
		cards,
		catalog = homeCardOptions
	}: { cards: readonly string[]; catalog?: readonly HomeCardOption[] } = $props();

	const byId = $derived(new Map(catalog.map((card) => [card.id, card])));
</script>

{#each cards as id (id)}
	{@const card = byId.get(id)}
	{#if card}
		<HomeSectionCard {card} />
	{/if}
{/each}
