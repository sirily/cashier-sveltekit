<script lang="ts">
	import { formatAmount, getAmountColour } from '#lib/utils/formatter';

	type Props = {
		balances: Record<string, number> | undefined;
		defaultCurrency: string;
		loaded: boolean;
		class?: string;
	};
	let { balances, defaultCurrency, loaded, class: className = '' }: Props = $props();

	const primaryCurrency = $derived(
		balances && defaultCurrency && defaultCurrency in balances
			? defaultCurrency
			: balances
				? (Object.keys(balances)[0] ?? '')
				: ''
	);
	const primaryQuantity = $derived(balances?.[primaryCurrency] ?? 0);
	const extraBalances = $derived(
		balances ? Object.entries(balances).filter(([cur]) => cur !== primaryCurrency) : []
	);
	const hasMultiple = $derived(extraBalances.length > 0);

	let expanded = $state(false);

	function toggle(e: MouseEvent | KeyboardEvent) {
		e.stopPropagation();
		expanded = !expanded;
	}
</script>

<div class={`flex flex-col items-end tabular-nums ${className}`}>
	{#if hasMultiple && loaded}
		<button
			type="button"
			class={`text-right ${getAmountColour(primaryQuantity)} cursor-pointer`}
			onclick={toggle}
			onkeydown={(e) => e.stopPropagation()}
		>
			{formatAmount(primaryQuantity)}&nbsp;{primaryCurrency}<span class="text-base-content/40">
				…</span
			>
		</button>
	{:else}
		<data
			class={`text-right ${loaded ? getAmountColour(primaryQuantity) : 'text-base-content/30'}`}
		>
			{loaded ? `${formatAmount(primaryQuantity)} ${primaryCurrency}` : '···'}
		</data>
	{/if}

	{#if expanded && loaded}
		{#each extraBalances as [currency, amount] (currency)}
			<data class={`text-right ${getAmountColour(amount)}`}>
				{formatAmount(amount)}&nbsp;{currency}
			</data>
		{/each}
	{/if}
</div>
