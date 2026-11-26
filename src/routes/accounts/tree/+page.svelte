<script lang="ts">
	import AccountTreeBody from '#lib/components/AccountTreeBody.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Tree" />
	<section class="min-h-0 flex-1 overflow-auto touch-pan-y">
		<AccountTreeBody />
	</section>
</article>
