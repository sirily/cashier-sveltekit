<script lang="ts">
	import type { Snippet } from 'svelte';
	import { readPayeeReferences } from '#lib/services/referenceLists';
	import ReferenceList from './ReferenceList.svelte';

	let {
		focus = false,
		onselect,
		controls
	}: {
		focus?: boolean;
		onselect?: (name: string) => void;
		controls?: Snippet<[string]>;
	} = $props();
	const classes =
		'border-base-content/15 flex min-h-11 w-full items-center border-b p-2 text-left wrap-break-word';
</script>

<ReferenceList label="Payees" {focus} read={readPayeeReferences} name={(payee) => payee} {controls}>
	{#snippet row(payee)}
		{#if onselect}
			<button type="button" class={classes} onclick={() => onselect?.(payee)}>{payee}</button>
		{:else}
			<div class={classes}>{payee}</div>
		{/if}
	{/snippet}
</ReferenceList>
