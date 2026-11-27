<script lang="ts">
	import CalculatorBody from '#lib/components/CalculatorBody.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import Check from '@lucide/svelte/icons/check';
	import { selectionMetadata } from '#lib/data/mainStore';
	import Notifier from '#lib/utils/notifier';

	const amountSelection = $derived(
		$selectionMetadata?.selectionType === 'amount' ? $selectionMetadata : undefined
	);

	function applyAmount(amount: string | undefined) {
		if (!amountSelection) return;
		if (amount === undefined) {
			Notifier.error('Enter a valid calculation before applying the amount.');
			return;
		}
		// Postings retain the text but also require a finite numeric projection.
		const projected = Number(amount);
		if (!Number.isFinite(projected) || (projected === 0 && /[1-9]/.test(amount))) {
			Notifier.error('This result is outside the supported amount range.');
			return;
		}
		amountSelection.selectedId = amount;
		history.back();
	}
</script>

<article class="bg-base-300 flex min-h-screen flex-col items-center justify-center p-4">
	<CalculatorBody
		initialValue={amountSelection?.initialValue}
		account={amountSelection?.calculatorAccount}
		onapply={amountSelection ? applyAmount : undefined}
	>
		{#snippet actions(apply)}
			<Fab Icon={Check} label="Apply amount" onclick={apply} />
		{/snippet}
	</CalculatorBody>
</article>
