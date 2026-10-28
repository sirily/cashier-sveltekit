<script lang="ts">
	import type { PageData } from './$types';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { invalidate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import type { UnifiedXact } from './+page.js';
	import * as Formatter from '#lib/utils/formatter';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import { xact, xactSpan } from '#lib/data/mainStore';

	let { data }: { data: PageData } = $props();
	const workerVersion = fullLedgerService.version;
	const workerReloading = fullLedgerService.isReloading;
	const workerLoaded = fullLedgerService.loaded;
	let result = $state<Awaited<PageData['history']> | null>(null);
	let isLoading = $derived(
		result === null ||
			$workerReloading ||
			(result.data !== null && (!$workerLoaded || result.data.version !== $workerVersion))
	);

	$effect(() => {
		const history = data.history;
		result = null;
		visibleCount = PAGE_SIZE;
		let active = true;
		void history.then((value) => {
			if (active) result = value;
		});
		return () => {
			active = false;
		};
	});

	$effect(() => {
		if (
			result?.data &&
			!$workerReloading &&
			(!$workerLoaded || result.data.version !== $workerVersion)
		) {
			void invalidate('ledger:account-history');
		}
	});

	const PAGE_SIZE = 30;
	let visibleCount = $state(PAGE_SIZE);
	let sentinel = $state<HTMLElement | null>(null);

	async function onRowClick(row: UnifiedXact) {
		if (!row.isDevice || !row.xact || !row.span) return;
		xact.set(row.xact);
		xactSpan.set(row.span);
		await goto(resolve('/xact-actions'));
	}

	const allRows = $derived(result?.data?.unifiedRows ?? []);
	const visibleRows = $derived(allRows.slice(0, visibleCount));

	$effect(() => {
		if (!sentinel) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting && visibleCount < allRows.length) {
				visibleCount = Math.min(visibleCount + PAGE_SIZE, allRows.length);
			}
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Account Transactions">
		{#snippet menuItems()}
			<ToolbarMenuItem
				Icon={ScaleIcon}
				text="Balance Adjustment"
				onclick={() =>
					goto(resolve(`/accounts/bal-adj?${new URLSearchParams({ account: data.accountName })}`))}
			/>
		{/snippet}
	</Toolbar>

	<section class="min-h-0 flex-1 overflow-y-auto space-y-2 p-1">
		{#if isLoading}
			<p role="status" class="p-4">Loading account history…</p>
		{:else if result?.error}
			<div role="alert" class="p-4">
				<p>Account history is unavailable: {result.error}</p>
				<button class="btn btn-sm" onclick={() => invalidate('ledger:account-history')}
					>Retry</button
				>
			</div>
		{:else if result?.data}
			<header>
				<p>{result.data.account.getParentName()}</p>
				<div class="flex flex-row text-2xl font-bold">
					<data class="grow">
						{result.data.account.getAccountName()}
					</data>
					<div class="flex flex-col items-end">
						{#each Object.entries(result.data.account.balances ?? {}) as [currency, balance] (currency)}
							<data class={Formatter.getAmountColour(balance)}
								>{Formatter.formatAmount(balance)}{currency}</data
							>
						{:else}
							<data>0</data>
						{/each}
					</div>
				</div>
			</header>

			{#if result.data.hasDeviceXacts}
				<div class="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
					<span class="inline-block h-3 w-1 rounded-sm bg-amber-400"></span>
					<span>Records only on device</span>
				</div>
			{/if}

			<!-- Double-line separator -->
			<div class="my-2 space-y-0.5">
				<hr class="border-gray-400" />
				<hr class="border-gray-400" />
			</div>

			<!-- Unified transaction list -->
			<div class="space-y-1">
				{#each visibleRows as row (row)}
					<div
						class="flex flex-row px-2 {row.isDevice
							? 'cursor-pointer border-l-2 border-amber-400 bg-amber-50/60 dark:bg-amber-950/25'
							: ''}"
						onclick={() => onRowClick(row)}
						onkeypress={() => onRowClick(row)}
						{...row.isDevice ? { role: 'button', tabindex: 0 } : {}}
					>
						<data class="mr-4 shrink-0">{row.date}</data>
						<data class="grow">
							{row.payee}{row.payee && row.narration ? ' | ' : ''}{row.narration}
						</data>
						<data class="shrink-0 {Formatter.getAmountColour(row.amount)}">
							{Formatter.formatAmount(row.amount)}
							{row.currency}
						</data>
					</div>
				{/each}
				<div bind:this={sentinel}></div>
			</div>
		{/if}
	</section>
</article>
