<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { goto } from '$app/navigation';

	import ChartBar from '@lucide/svelte/icons/chart-bar';
	import ChartPie from '@lucide/svelte/icons/chart-pie';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import PeriodSelector, { type Period } from '#lib/components/PeriodSelector.svelte';
	import ExpensesBarChart from '#lib/components/ExpensesBarChart.svelte';
	import ExpensesDonutChart from '#lib/components/ExpensesDonutChart.svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '#lib/settings';
	import ReportCompleteness from '#lib/components/ReportCompleteness.svelte';
	import { queryReportPostings, type ReportPostings } from '#lib/services/reportPostings';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';

	type ChartType = 'bar' | 'donut';
	let chartType = $state<ChartType>('bar');
	const workerVersion = fullLedgerService.version;
	const workerReloading = fullLedgerService.isReloading;
	const request = new ReportRequest<{
		result: ReportPostings;
		currency: string;
		labels: string[];
		values: number[];
		version: number;
	}>();
	let isLoading = $derived(
		request.pending ||
			$workerReloading ||
			(request.value !== null && request.value.version !== $workerVersion)
	);
	let error = $derived(request.error);
	let chartLabels = $derived(request.value?.labels ?? []);
	let chartValues = $derived(request.value?.values ?? []);
	let expenseTotal = $derived(chartValues.reduce((sum, v) => sum + v, 0));
	let displayCurrency = $derived(request.value?.currency ?? '');
	let currentPeriod = $state<Period | null>(null);

	function handleBarClick(account: string) {
		if (!currentPeriod) return;
		const params = new URLSearchParams({
			account,
			dateFrom: currentPeriod.dateFrom,
			dateTo: currentPeriod.dateTo
		});
		goto(resolve(`/reports/tx-search?${params.toString()}`));
	}

	function loadExpenses(period: Period) {
		currentPeriod = period;
	}

	$effect(() => {
		const period = currentPeriod;
		const version = $workerVersion;
		const reloading = $workerReloading;
		untrack(() => {
			if (!period || reloading) {
				request.cancel();
				return;
			}
			void request.run(
				async () => {
					const currency = (await settings.get<string>(SettingKeys.currency)) ?? '';
					await fullLedgerService.ensureLoaded();
					if (!fullLedgerService.isLoaded)
						throw new Error('Ledger analysis is unavailable. Configure a book and reload.');
					const result = await queryReportPostings(fullLedgerService, {
						scope: 'expenses',
						dateFrom: period.dateFrom,
						dateTo: period.dateTo,
						currency
					});
					const totals = new SvelteMap<string, number>();
					for (const { account, amount } of result.postings) {
						totals.set(account, (totals.get(account) ?? 0) + amount);
					}
					const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
					return {
						result,
						currency,
						labels: sorted.map(([account]) => account),
						values: sorted.map(([, value]) => value),
						version
					};
				},
				() => !$workerReloading && $workerVersion === version
			);
		});
		return () => request.cancel();
	});
</script>

<article class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Expenses" />

	<!-- Period selector + chart type toggle -->
	<div class="flex items-center gap-3 px-4 pt-3 pb-2">
		<span class="text-sm font-medium text-base-content/60">Period:</span>
		<PeriodSelector onselect={loadExpenses} />
		<div class="ml-auto flex gap-1">
			<button
				class="btn btn-ghost btn-sm btn-square"
				class:bg-base-200={chartType === 'bar'}
				onclick={() => (chartType = 'bar')}
				title="Bar chart"
			>
				<ChartBar size={16} />
			</button>
			<button
				class="btn btn-ghost btn-sm btn-square"
				class:bg-base-200={chartType === 'donut'}
				onclick={() => (chartType = 'donut')}
				title="Donut chart"
			>
				<ChartPie size={16} />
			</button>
		</div>
	</div>

	<!-- Chart area -->
	<section class="grow overflow-y-auto touch-pan-y px-4 py-2">
		{#if isLoading}
			<div class="flex justify-center py-12">
				<span class="loading loading-spinner loading-md"></span>
			</div>
		{:else if error}
			<div class="rounded-lg border border-error bg-error/10 p-3 text-error text-sm font-mono">
				{error}
			</div>
		{:else if request.value}
			<ReportCompleteness result={request.value.result} currency={displayCurrency} />
			{#if !request.value.result.complete}
				<!-- Never render a partial chart or a successful-empty state. -->
			{:else if chartLabels.length === 0}
				<div class="py-12 text-center text-base-content/50 text-sm">
					No expense data for this period.
				</div>
			{:else if chartType === 'bar'}
				<ExpensesBarChart labels={chartLabels} values={chartValues} onclick={handleBarClick} />
			{:else}
				<ExpensesDonutChart labels={chartLabels} values={chartValues} onclick={handleBarClick} />
			{/if}
		{/if}
	</section>

	<!-- Total -->
	{#if !isLoading && !error && request.value?.result.complete && chartValues.length > 0}
		<div class="flex justify-end px-4 py-2 border-t border-base-300 text-sm font-medium">
			<span class="text-base-content/60 mr-2">Total:</span>
			<span>{expenseTotal.toFixed(2)}{displayCurrency ? ` ${displayCurrency}` : ''}</span>
		</div>
	{/if}
</article>
