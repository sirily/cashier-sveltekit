<script lang="ts">
	import { resolve } from '$app/paths';
	import Toolbar from '#lib/components/Toolbar.svelte';
</script>

<article>
	<Toolbar title="Reports" />

	<div class="flex-1 overflow-y-auto touch-pan-y px-1">
		<div class="mx-auto flex w-350 max-w-[350px] flex-col gap-6 px-4 pt-4 sm:px-6">
			<a href={resolve("/reports/query")} class="btn btn-primary">
				Queries
			</a>
			<a href={resolve("/reports/tx-search")} class="btn btn-primary">
				Transaction Search
			</a>
			<a href={resolve("/reports/assets")} class="btn btn-primary">
				Assets
			</a>
			<a href={resolve("/reports/expenses")} class="btn btn-primary">
				Expenses
			</a>
			<a href={resolve("/reports/income-expense")} class="btn btn-primary">
				Income vs Expenses
			</a>
		</div>
	</div>
</article>
