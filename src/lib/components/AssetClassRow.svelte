<script lang="ts">
	import { AssetClass } from '#lib/assetAllocation/AssetClass.js';
	import { getOffsetColor, getRowColor } from '#lib/assetAllocation/assetAllocationUtils.js';
	import { NUMBER_FORMAT } from '#lib/constants.js';
	import numeral from 'numeral';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import AssetClassRow from './AssetClassRow.svelte';
	import { resolve } from '$app/paths';

	let {
		assetClass,
		children = [],
		depth = 0,
		collapsedState,
		onToggle,
		childrenIndex,
		viewMode,
		showValues,
		showPercentages
	}: {
		assetClass: AssetClass;
		children?: AssetClass[];
		depth?: number;
		collapsedState: Record<string, boolean>;
		onToggle: (fullname: string) => void;
		childrenIndex?: Map<string, AssetClass[]>;
		viewMode: 'allocation' | 'value';
		showValues: boolean;
		showPercentages: boolean;
	} = $props();

	function isCollapsible(ac: AssetClass): boolean {
		return !ac.symbols?.length && children.length > 0;
	}

	function toggleCollapse() {
		if (isCollapsible(assetClass)) {
			onToggle(assetClass.fullname);
		}
	}

	function getIndentClass() {
		const indentClasses = ['pl-0', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20'];
		return indentClasses[depth] || indentClasses[indentClasses.length - 1];
	}

	function getBorderClass() {
		if (depth === 0) return '';
		return 'border-l border-base-300';
	}

	function getChildren(fullname: string): AssetClass[] {
		return childrenIndex?.get(fullname) || [];
	}

	const allocHidden = $derived(viewMode !== 'allocation' ? ' hidden lg:table-cell' : '');
	const valueHidden = $derived(viewMode !== 'value' ? ' hidden lg:table-cell' : '');
	const showRelativeDifference = $derived(showPercentages && assetClass.allocation !== 0);
	const offsetColor = $derived(showRelativeDifference ? getOffsetColor(assetClass.diffPerc) : '');
</script>

<!-- Row for this asset class -->
<tr class="border-base-content/15 border-b {getRowColor(assetClass)} {getBorderClass()}">
	<td class="py-0.5">
		<div class="flex min-w-0 items-center">
			{#if isCollapsible(assetClass)}
				<button
					class="hover:bg-base-300 mr-2 rounded p-1 transition-colors duration-200"
					type="button"
					aria-label={collapsedState[assetClass.fullname]
						? 'Expand ' + assetClass.name
						: 'Collapse ' + assetClass.name}
					aria-expanded={!collapsedState[assetClass.fullname]}
					onclick={toggleCollapse}
				>
					{#if collapsedState[assetClass.fullname]}
						<ChevronRight class="h-4 w-4" />
					{:else}
						<ChevronDown class="h-4 w-4" />
					{/if}
				</button>
			{/if}
			{#if depth > 0}
				<div class="flex">
					{#each Array(depth).fill(0) as _, i (i)}
						<div class="border-base-300 mr-1 h-full w-2 border-l"></div>
					{/each}
				</div>
			{/if}
			<span class="truncate">
				<a
					class="underline"
					href={resolve('/assetclass-detail/[name]', { name: assetClass.fullname })}
				>
					{assetClass.name}
				</a>
			</span>
		</div>
	</td>
	<td class="text-end{allocHidden}">
		{numeral(assetClass.allocation).format(NUMBER_FORMAT)}
	</td>
	<td class="text-end{allocHidden}">
		{showPercentages ? numeral(assetClass.currentAllocation).format(NUMBER_FORMAT) : '—'}
	</td>
	<td class="text-end{allocHidden} {offsetColor}">
		{showRelativeDifference ? numeral(assetClass.diffPerc).format(NUMBER_FORMAT) : '—'}
	</td>
	<td class="text-end{valueHidden}">
		{showValues ? numeral(assetClass.allocatedValue).format(NUMBER_FORMAT) : '—'}
	</td>
	<td class="text-end{valueHidden}">
		{showValues ? numeral(assetClass.currentValue).format(NUMBER_FORMAT) : '—'}
	</td>
	<td class="pr-1 text-end{valueHidden} {offsetColor}">
		{showValues ? numeral(assetClass.diffAmount).format(NUMBER_FORMAT) : '—'}
	</td>
</tr>

<!-- Recursively render children -->
{#if children.length > 0 && !collapsedState[assetClass.fullname]}
	{#each children as child (child.fullname)}
		<AssetClassRow
			assetClass={child}
			children={getChildren(child.fullname)}
			depth={depth + 1}
			{collapsedState}
			{onToggle}
			{childrenIndex}
			{viewMode}
			{showValues}
			{showPercentages}
		/>
	{/each}
{/if}
