<script lang="ts">
	import CalculatorBody from '#lib/components/CalculatorBody.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import Check from '@lucide/svelte/icons/check';
	import { selectionMetadata } from '#lib/data/mainStore';
	import Notifier from '#lib/utils/notifier';

	function applyAmount(amount: number) {
		if (!$selectionMetadata) return;
		if (Number.isFinite(amount)) $selectionMetadata.selectedId = amount;
		else Notifier.error('The value is not a number!');
		history.back();
	}
</script>

<article class="bg-base-300 flex min-h-screen flex-col items-center justify-center p-4">
	<CalculatorBody
		initialValue={$selectionMetadata?.initialValue}
		onapply={$selectionMetadata ? applyAmount : undefined}
	>
		{#snippet actions(apply)}
			<Fab Icon={Check} label="Apply amount" onclick={apply} />
		{/snippet}
	</CalculatorBody>
</article>
