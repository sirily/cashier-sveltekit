<script lang="ts">
	import ReportLinks from '#lib/components/ReportLinks.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
</script>

<article>
	<Toolbar title="Reports" />

	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		<div class="mx-auto max-w-sm px-4 pt-4 sm:px-6">
			<ReportLinks />
		</div>
	</div>
</article>
