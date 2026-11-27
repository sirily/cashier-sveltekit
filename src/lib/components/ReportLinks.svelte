<script lang="ts">
	import { resolve } from '$app/paths';

	const reports = [
		{ path: '/reports/query', label: 'Queries' },
		{ path: '/reports/tx-search', label: 'Transaction Search' },
		{ path: '/reports/assets', label: 'Assets' },
		{ path: '/reports/expenses', label: 'Expenses' },
		{ path: '/reports/income-expense', label: 'Income vs Expenses' }
	] as const;
</script>

<div class="grid gap-2">
	{#each reports as { path, label } (path)}
		<a href={resolve(path)} class="btn btn-primary">{label}</a>
	{/each}
</div>
