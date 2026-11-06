<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity';

	import { resolve } from '$app/paths';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import AccordionSection from '#lib/components/AccordionSection.svelte';
	import IncomeExpenseChart from '#lib/components/IncomeExpenseChart.svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { SettingKeys, settings } from '#lib/settings';
	import ReportCompleteness from '#lib/components/ReportCompleteness.svelte';
	import { queryReportPostings, type ReportPostings } from '#lib/services/reportPostings';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';

	interface DayEntry {
		date: string;
		label: string;
		amount: number;
	}

	interface MonthDetail {
		key: string;
		label: string;
		total: number;
		days: DayEntry[];
		isOutlier: boolean;
	}

	const currentYear = new Date().getFullYear();
	const availableYears = Array.from({ length: 10 }, (_, i) => currentYear - i);

	let selectedPeriod = $state('last12');
	const workerVersion = fullLedgerService.version;
	const workerReloading = fullLedgerService.isReloading;
	const request = new ReportRequest<{
		result: ReportPostings;
		currency: string;
		months: string[];
		incomeMonths: MonthDetail[];
		expenseMonths: MonthDetail[];
		dateTo: string;
		version: number;
	}>();
	let isLoading = $derived(
		request.pending ||
			$workerReloading ||
			(request.value !== null && request.value.version !== $workerVersion)
	);
	let error = $derived(request.error);
	let months = $derived(request.value?.months ?? []);
	let incomeMonths = $derived(request.value?.incomeMonths ?? []);
	let expenseMonths = $derived(request.value?.expenseMonths ?? []);
	let incomeData = $derived(incomeMonths.map((month) => month.total));
	let expensesData = $derived(expenseMonths.map((month) => month.total));
	let incomeExpanded = $state(false);
	let expensesExpanded = $state(false);
	let displayCurrency = $derived(request.value?.currency ?? '');

	let maxIncome = $derived(incomeData.reduce((m, v) => Math.max(m, v), 1));
	let maxExpenses = $derived(expensesData.reduce((m, v) => Math.max(m, v), 1));
	let incomeTotal = $derived(incomeData.reduce((s, v) => s + v, 0));
	let expensesTotal = $derived(expensesData.reduce((s, v) => s + v, 0));

	function getLast12Months() {
		const now = new Date();
		const result: { key: string; label: string }[] = [];
		for (let i = 11; i >= 0; i--) {
			const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
			const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
			const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
			result.push({ key, label });
		}
		return result;
	}

	function getYearMonths(year: number) {
		const result: { key: string; label: string }[] = [];
		for (let m = 0; m < 12; m++) {
			const d = new Date(year, m, 1);
			const key = `${year}-${String(m + 1).padStart(2, '0')}`;
			const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
			result.push({ key, label });
		}
		return result;
	}

	function getMonthList() {
		if (selectedPeriod === 'last12') return getLast12Months();
		return getYearMonths(parseInt(selectedPeriod));
	}

	function lastDayOfMonth(yearMonth: string): string {
		const [y, m] = yearMonth.split('-').map(Number);
		const d = new Date(y, m, 0);
		return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	function toDateStr(raw: unknown): string {
		if (!raw) return '';
		const s = String(raw);
		if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
		const d = new Date(s);
		return isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
	}

	function markOutliers(items: MonthDetail[]): MonthDetail[] {
		const vals = items.filter((m) => m.total > 0).map((m) => m.total);
		if (vals.length < 3) return items;
		const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
		const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
		const threshold = 1.5 * std;
		return items.map((m) => ({
			...m,
			isOutlier: m.total > 0 && Math.abs(m.total - mean) > threshold
		}));
	}

	function formatMoney(amount: number): string {
		return `${amount.toFixed(2)}${displayCurrency ? ` ${displayCurrency}` : ''}`;
	}

	function txSearchUrl(
		accountPattern: string,
		monthKey?: string,
		singleDate?: string
	): URLSearchParams {
		const params = new SvelteURLSearchParams({ account: accountPattern });
		if (singleDate) {
			params.set('dateFrom', singleDate);
			params.set('dateTo', singleDate);
		} else if (monthKey) {
			params.set('dateFrom', monthKey + '-01');
			const monthEnd = lastDayOfMonth(monthKey);
			const reportEnd = request.value?.dateTo ?? monthEnd;
			params.set('dateTo', monthEnd < reportEnd ? monthEnd : reportEnd);
		}
		return params;
	}

	async function loadData(
		monthList: { key: string; label: string }[],
		dateTo: string,
		version: number
	) {
		const currency = (await settings.get<string>(SettingKeys.currency)) ?? '';
		await fullLedgerService.ensureLoaded();
		if (!fullLedgerService.isLoaded)
			throw new Error('Ledger analysis is unavailable. Configure a book and reload.');
		const result = await queryReportPostings(fullLedgerService, {
			scope: 'income-expense',
			dateFrom: monthList[0].key + '-01',
			dateTo,
			currency
		});

		const incomeMap = new SvelteMap<string, Map<string, number>>();
		const expenseMap = new SvelteMap<string, Map<string, number>>();
		for (const { key } of monthList) {
			incomeMap.set(key, new Map());
			expenseMap.set(key, new Map());
		}

		for (const { date, account, amount } of result.postings) {
			const dateStr = toDateStr(date);
			const monthKey = dateStr.slice(0, 7);

			if (account.startsWith('Income') && incomeMap.has(monthKey)) {
				const dm = incomeMap.get(monthKey)!;
				dm.set(dateStr, (dm.get(dateStr) ?? 0) + -amount); // negate: income is negative in beancount
			} else if (account.startsWith('Expenses') && expenseMap.has(monthKey)) {
				const dm = expenseMap.get(monthKey)!;
				dm.set(dateStr, (dm.get(dateStr) ?? 0) + amount);
			}
		}

		function buildDetails(
			list: { key: string; label: string }[],
			map: Map<string, Map<string, number>>
		): MonthDetail[] {
			return list.map(({ key, label }) => {
				const dayMap = map.get(key) ?? new Map();
				const days: DayEntry[] = [...dayMap.entries()]
					.sort(([a], [b]) => b.localeCompare(a))
					.map(([date, amount]) => {
						const d = new Date(date + 'T00:00:00');
						return {
							date,
							label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
							amount
						};
					});
				return {
					key,
					label,
					total: days.reduce((s, d) => s + d.amount, 0),
					days,
					isOutlier: false
				};
			});
		}

		const rawIncome = markOutliers(buildDetails(monthList, incomeMap));
		const rawExpenses = markOutliers(buildDetails(monthList, expenseMap));

		return {
			result,
			currency,
			version,
			dateTo,
			months: [...monthList].reverse().map((m) => m.label),
			incomeMonths: [...rawIncome].reverse(),
			expenseMonths: [...rawExpenses].reverse()
		};
	}

	$effect(() => {
		const monthList = getMonthList();
		const dateTo =
			selectedPeriod === 'last12'
				? new Date().toISOString().slice(0, 10)
				: lastDayOfMonth(monthList[11].key);
		const version = $workerVersion;
		const reloading = $workerReloading;
		untrack(() => {
			if (reloading) request.cancel();
			else
				void request.run(
					() => loadData(monthList, dateTo, version),
					() => !$workerReloading && $workerVersion === version
				);
		});
		return () => request.cancel();
	});
</script>

<article class="flex h-screen flex-col" class:cursor-wait={isLoading}>
	<Toolbar title="Income vs Expenses" />

	<div class="flex items-center gap-3 border-b border-base-300 px-4 py-2">
		<span class="text-sm font-medium text-base-content/60">Period:</span>
		<select class="select select-bordered select-sm" bind:value={selectedPeriod}>
			<option value="last12">Last 12 months</option>
			{#each availableYears as year (year)}
				<option value={String(year)}>{year}</option>
			{/each}
		</select>
	</div>

	<section class="grow overflow-y-auto touch-pan-y px-4 py-4">
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
			{#if request.value.result.complete}
				{#if months.length > 0}
					<IncomeExpenseChart
						{months}
						income={incomeData}
						expenses={expensesData}
						currency={displayCurrency}
					/>
				{:else}
					<div class="py-12 text-center text-base-content/50 text-sm">No data available.</div>
				{/if}

				{#if incomeMonths.length > 0 || expenseMonths.length > 0}
					<div class="mt-6 flex flex-col gap-3">
						<!-- Income breakdown -->
						<AccordionSection
							title="Income"
							badge={formatMoney(incomeTotal)}
							expanded={incomeExpanded}
							onToggle={() => (incomeExpanded = !incomeExpanded)}
						>
							<div class="flex flex-col divide-y divide-base-200">
								{#each incomeMonths as month (month.key)}
									<details class="group">
										<summary
											class="flex cursor-pointer list-none items-center justify-between py-2 [&::-webkit-details-marker]:hidden"
										>
											<div class="flex items-center gap-2">
												{#if month.isOutlier}
													<span class="text-xs font-bold text-warning" title="Unusual amount"
														>!</span
													>
												{/if}
												<span class="text-sm">{month.label}</span>
											</div>
											<div class="flex items-center gap-2">
												<div class="h-1.5 w-12 overflow-hidden rounded-full bg-base-300">
													<div
														class="h-full rounded-full bg-success"
														style="width: {((month.total / maxIncome) * 100).toFixed(0)}%"
													></div>
												</div>
												<span
													class="w-20 text-right font-mono text-sm tabular-nums"
													class:text-warning={month.isOutlier}>{formatMoney(month.total)}</span
												>
												<span
													class="text-xs text-base-content/40 transition-transform group-open:rotate-90"
													>▶</span
												>
											</div>
										</summary>
										<div class="mb-2 ml-4 flex flex-col">
											<a
												href={resolve(`/reports/tx-search?${txSearchUrl('^Income', month.key)}`)}
												class="px-2 py-1 text-xs text-primary hover:underline"
												>All transactions — {month.label}</a
											>
											{#each month.days as day (day.date)}
												<a
													href={resolve(
														`/reports/tx-search?${txSearchUrl('^Income', undefined, day.date)}`
													)}
													class="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-base-200"
												>
													<span class="text-base-content/70">{day.label}</span>
													<span class="font-mono tabular-nums">{formatMoney(day.amount)}</span>
												</a>
											{/each}
										</div>
									</details>
								{/each}
							</div>
						</AccordionSection>

						<!-- Expenses breakdown -->
						<AccordionSection
							title="Expenses"
							badge={formatMoney(expensesTotal)}
							expanded={expensesExpanded}
							onToggle={() => (expensesExpanded = !expensesExpanded)}
						>
							<div class="flex flex-col divide-y divide-base-200">
								{#each expenseMonths as month (month.key)}
									<details class="group">
										<summary
											class="flex cursor-pointer list-none items-center justify-between py-2 [&::-webkit-details-marker]:hidden"
										>
											<div class="flex items-center gap-2">
												{#if month.isOutlier}
													<span class="text-xs font-bold text-warning" title="Unusual amount"
														>!</span
													>
												{/if}
												<span class="text-sm">{month.label}</span>
											</div>
											<div class="flex items-center gap-2">
												<div class="h-1.5 w-12 overflow-hidden rounded-full bg-base-300">
													<div
														class="h-full rounded-full bg-error"
														style="width: {((month.total / maxExpenses) * 100).toFixed(0)}%"
													></div>
												</div>
												<span
													class="w-20 text-right font-mono text-sm tabular-nums"
													class:text-warning={month.isOutlier}>{formatMoney(month.total)}</span
												>
												<span
													class="text-xs text-base-content/40 transition-transform group-open:rotate-90"
													>▶</span
												>
											</div>
										</summary>
										<div class="mb-2 ml-4 flex flex-col">
											<a
												href={resolve(`/reports/tx-search?${txSearchUrl('^Expenses', month.key)}`)}
												class="px-2 py-1 text-xs text-primary hover:underline"
												>All transactions — {month.label}</a
											>
											{#each month.days as day (day.date)}
												<a
													href={resolve(
														`/reports/tx-search?${txSearchUrl('^Expenses', undefined, day.date)}`
													)}
													class="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-base-200"
												>
													<span class="text-base-content/70">{day.label}</span>
													<span class="font-mono tabular-nums">{formatMoney(day.amount)}</span>
												</a>
											{/each}
										</div>
									</details>
								{/each}
							</div>
						</AccordionSection>
					</div>
				{/if}
			{/if}
		{/if}
	</section>
</article>
