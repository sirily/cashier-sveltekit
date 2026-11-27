<script lang="ts">
	import { resolve } from '$app/paths';
	import { readAccountReferences } from '#lib/services/referenceLists';
	import ReferenceList from './ReferenceList.svelte';

	let { focus = false, onselect }: { focus?: boolean; onselect?: (name: string) => void } =
		$props();

	function colour(name: string) {
		if (name.startsWith('Income:')) return 'text-primary-200';
		if (name.startsWith('Expenses:')) return 'text-secondary-200';
		if (name.startsWith('Liabilities:')) return 'text-purple-200';
		return '';
	}
</script>

<ReferenceList
	label="Accounts"
	{focus}
	read={readAccountReferences}
	name={(account) => account.name}
>
	{#snippet row(account)}
		{@const classes = `border-base-content/15 flex w-full items-center justify-between gap-2 border-b px-2 py-2 text-left ${colour(account.name)}`}
		{#snippet contents()}
			<strong class="min-w-0 font-normal wrap-break-word">{account.name}</strong>
			{#if account.currencies.length}
				<span class="shrink-0 text-sm opacity-60">{account.currencies.join(', ')}</span>
			{/if}
		{/snippet}
		{#if onselect}
			<button type="button" class={classes} onclick={() => onselect?.(account.name)}
				>{@render contents()}</button
			>
		{:else}
			<a
				class={classes}
				data-sveltekit-preload-data="off"
				href={resolve('/accounts/account-xacts/[accountName]', {
					accountName: encodeURIComponent(account.name)
				})}>{@render contents()}</a
			>
		{/if}
	{/snippet}
</ReferenceList>
