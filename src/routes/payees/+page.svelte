<script lang="ts">
	import PayeesBody from '#lib/components/PayeesBody.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { selectionMetadata } from '#lib/data/mainStore';
	import Fab from '#lib/components/FAB.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';

	const picking = $derived($selectionMetadata?.selectionType === 'payee');

	function select(name: string) {
		if (!picking || !$selectionMetadata || !name) return;
		$selectionMetadata.selectedId = name;
		history.back();
	}
</script>

<article class="flex h-full flex-col">
	<Toolbar title="Payees" />
	<section class="min-h-0 flex-1 overflow-auto touch-pan-y">
		<PayeesBody focus onselect={picking ? select : undefined}>
			{#snippet controls(term)}
				{#if picking && term}
					<Fab Icon={CheckIcon} label="Use typed payee" onclick={() => select(term)} />
				{/if}
			{/snippet}
		</PayeesBody>
	</section>
</article>
