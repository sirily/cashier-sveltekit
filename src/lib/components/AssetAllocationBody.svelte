<script lang="ts">
	import { loadAssetAllocation } from '#lib/assetAllocation/loadAssetAllocation';
	import type { AssetAllocationEngine } from '#lib/assetAllocation/AssetAllocation';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';
	import { AssetAllocationLoadedAtStore } from '#lib/data/mainStore';
	import { AppError } from '#lib/utils/errors';
	import AssetClassRow from './AssetClassRow.svelte';

	const request = new ReportRequest<{ engine: AssetAllocationEngine; version: number }>();
	const version = fullLedgerService.version;
	const reloading = fullLedgerService.isReloading;
	const allocation = $derived(request.value?.engine.assetClasses ?? []);
	const childrenIndex = $derived(request.value?.engine.childrenIndex);
	const pending = $derived(
		$reloading || request.pending || (request.value !== null && request.value.version !== $version)
	);
	let collapsedState = $state<Record<string, boolean>>({});
	let viewMode = $state<'allocation' | 'value'>('allocation');

	$effect(() => {
		const currentVersion = $version;
		if ($reloading) return;
		void reload(currentVersion);
		return () => request.cancel();
	});

	export async function reload(currentVersion = $version) {
		await request.run(
			async () => {
				try {
					return { engine: await loadAssetAllocation(), version: currentVersion };
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					throw new Error(
						error instanceof AppError && error.action ? reason + ' ' + error.action : reason
					);
				}
			},
			() => currentVersion === $version && !$reloading
		);
		return current();
	}

	export function current() {
		return {
			engine: pending ? undefined : request.value?.engine,
			error: pending ? null : request.error
		};
	}

	function toggleCollapse(fullname: string) {
		collapsedState[fullname] = !collapsedState[fullname];
	}
</script>

<!-- View mode toggle — small screens only -->
<div class="lg:hidden shrink-0 flex items-center justify-center bg-primary py-1.5">
	<div class="view-toggle">
		<button
			class="view-toggle-btn"
			class:active={viewMode === 'allocation'}
			aria-label="Allocation percentages"
			aria-pressed={viewMode === 'allocation'}
			onclick={() => (viewMode = 'allocation')}>%</button
		>
		<button
			class="view-toggle-btn"
			class:active={viewMode === 'value'}
			aria-label="Allocation values"
			aria-pressed={viewMode === 'value'}
			onclick={() => (viewMode = 'value')}>###</button
		>
	</div>
</div>

<section class="overflow-x-auto p-3">
	<table class="mx-auto max-w-4xl">
		<thead>
			<tr>
				<th colspan="1"></th>
				<th
					colspan="3"
					class="text-center border-r{viewMode !== 'allocation' ? ' hidden' : ''} lg:table-cell"
					>Allocation</th
				>
				<th colspan="3" class="text-center{viewMode !== 'value' ? ' hidden' : ''} lg:table-cell"
					>Value</th
				>
			</tr>
			<tr>
				<th class="table-cell-fit px-2 text-center">Asset Class</th>
				<th
					class="table-cell-fit px-2 text-center{viewMode !== 'allocation'
						? ' hidden'
						: ''} lg:table-cell">Target</th
				>
				<th
					class="table-cell-fit px-2 text-center{viewMode !== 'allocation'
						? ' hidden'
						: ''} lg:table-cell">Current</th
				>
				<th
					class="table-cell-fit px-2 text-center{viewMode !== 'allocation'
						? ' hidden'
						: ''} lg:table-cell">Diff %</th
				>
				<th
					class="table-cell-fit px-2 text-center{viewMode !== 'value'
						? ' hidden'
						: ''} lg:table-cell">Allocated</th
				>
				<th
					class="table-cell-fit pr-2 pl-5 text-center{viewMode !== 'value'
						? ' hidden'
						: ''} lg:table-cell">Current</th
				>
				<th
					class="table-cell-fit px-2 text-center{viewMode !== 'value'
						? ' hidden'
						: ''} lg:table-cell">Difference</th
				>
			</tr>
		</thead>
		<tbody>
			{#if pending}
				<tr
					><td colspan="7"
						><p role="status" class="py-4 text-center">Loading asset allocation…</p></td
					></tr
				>
			{:else if allocation.length > 0}
				{#each allocation.filter((item) => item.depth === 0) as rootItem (rootItem.fullname)}
					<AssetClassRow
						assetClass={rootItem}
						children={childrenIndex?.get(rootItem.fullname)}
						depth={0}
						{collapsedState}
						onToggle={toggleCollapse}
						{childrenIndex}
						{viewMode}
					/>
				{/each}
			{:else}
				<tr>
					<td colspan="7" class="py-4 text-center">
						{#if request.error}
							<p role="alert">{request.error}</p>
						{:else}
							No asset allocation data available
						{/if}
					</td>
				</tr>
			{/if}
		</tbody>
	</table>
</section>

{#if !pending && request.value?.engine.warnings.length}
	<ul class="space-y-1 px-3 text-sm">
		{#each request.value.engine.warnings as warning (warning)}
			<li>{warning}</li>
		{/each}
	</ul>
{/if}
<p class="px-3 py-1 text-right text-xs text-base-content/50">
	{!pending && request.value && $AssetAllocationLoadedAtStore
		? 'Loaded at ' + $AssetAllocationLoadedAtStore.toLocaleTimeString()
		: 'Not loaded'}
</p>

<style>
	.view-toggle {
		display: flex;
		border-radius: 0.25rem;
		overflow: hidden;
		border: 1px solid var(--color-primary-900);
	}

	.view-toggle-btn {
		padding: 0.25rem 1.25rem;
		background-color: var(--color-primary-700);
		color: var(--color-accent-200);
		font-size: 0.85rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
		border: none;
		box-shadow:
			0 2px 4px rgba(0, 0, 0, 0.3),
			inset 0 1px 0 rgba(255, 255, 255, 0.07);
		transition:
			background-color 0.1s,
			box-shadow 0.1s;
	}

	.view-toggle-btn:not(:last-child) {
		border-right: 1px solid var(--color-primary-900);
	}

	.view-toggle-btn.active {
		background-color: var(--color-primary-950);
		box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.55);
	}

	.view-toggle-btn:hover:not(.active) {
		background-color: var(--color-primary-600);
	}
</style>
