<script lang="ts">
	import AccountsBody from '#lib/components/AccountsBody.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { selectionMetadata } from '#lib/data/mainStore';

	const picking = $derived($selectionMetadata?.selectionType?.toLowerCase() === 'account');

	function select(name: string) {
		if (!picking || !$selectionMetadata) return;
		$selectionMetadata.selectedId = name;
		history.back();
	}
</script>

<article class="flex h-full flex-col">
	<Toolbar title="Accounts" />
	<section class="min-h-0 flex-1 overflow-auto touch-pan-y">
		<AccountsBody focus onselect={picking ? select : undefined} />
	</section>
</article>
