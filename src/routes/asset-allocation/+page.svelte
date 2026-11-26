<script lang="ts">
	import { resolve } from '$app/paths';
	import { validate } from '#lib/assetAllocation/assetAllocationValidation';
	import { resetAssetAllocation } from '#lib/assetAllocation/loadAssetAllocation';
	import AssetAllocationBody from '#lib/components/AssetAllocationBody.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import Notifier from '#lib/utils/notifier';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import ScaleIcon from '@lucide/svelte/icons/scale';
	import CircleHelpIcon from '@lucide/svelte/icons/circle-help';

	let body = $state<ReturnType<typeof AssetAllocationBody>>();

	function downloadAsFile(content: string) {
		let now = new Date();
		let filename = 'asset-allocation_';
		filename += now.toISOString().substring(0, 10);
		filename += '_';
		filename += ('' + now.getHours()).padStart(2, '0');
		filename += '-';
		filename += ('' + now.getMinutes()).padStart(2, '0');
		filename += '.txt';

		const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
		const url = URL.createObjectURL(blob);

		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();

		requestIdleCallback(
			() => {
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			},
			{ timeout: 2000 }
		);
	}

	async function onRefreshClick() {
		resetAssetAllocation();
		await body?.reload();
	}

	function onExportClick() {
		const result = body?.current();
		if (!result?.engine) {
			Notifier.error(result?.error ?? 'Asset allocation is not loaded.');
			return;
		}
		downloadAsFile(result.engine.formatAllocationRowsForTxtExport(result.engine.assetClasses));
	}

	async function onValidateClick() {
		const result = await body?.reload();
		if (!result?.engine) {
			Notifier.error(result?.error ?? 'Asset allocation is not loaded.');
			return;
		}
		const errors = validate(result.engine);
		if (errors.length) Notifier.error(errors.join('\n'));
		else Notifier.success('The allocation is valid.');
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Asset Allocation">
		{#snippet menuItems()}
			<ToolbarMenuItem text="Export" Icon={FileDownIcon} onclick={onExportClick} />
			<ToolbarMenuItem text="Validate" Icon={ScaleIcon} onclick={onValidateClick} />
			<ToolbarMenuItem
				text="Help"
				Icon={CircleHelpIcon}
				targetNav={resolve('/help#asset-allocation')}
			/>
		{/snippet}
	</Toolbar>
	<AssetAllocationBody bind:this={body} />
	<footer class="flex justify-end px-3 py-1">
		<button type="button" class="btn btn-ghost btn-xs" onclick={onRefreshClick} title="Reload">
			<RefreshCwIcon size={14} />
		</button>
	</footer>
</article>
