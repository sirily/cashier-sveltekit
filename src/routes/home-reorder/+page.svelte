<script lang="ts">
	import DragReorderList from '#lib/components/DragReorderList.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { SettingKeys, settings } from '#lib/settings';
	import { homeCardOptions } from '#lib/navigation';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { onMount } from 'svelte';
	import appService from '#lib/services/appService';

	interface Item {
		id: string;
		name: string;
	}
	let items = $state<Item[]>([]);

	onMount(async () => {
		const cardNames = await appService.getVisibleCards();
		items = cardNames.map((name: string, index: number) => ({ id: index.toString(), name }));
	});

	async function onFabClicked() {
		await settings.set(
			SettingKeys.visibleCards,
			items.map((item) => item.name)
		);
		history.back();
	}
</script>

<Toolbar title="Reorder Cards" />
<Fab Icon={CheckIcon} label="Save Card Order" onclick={onFabClicked} />

<DragReorderList
	bind:items
	getLabel={(item) => homeCardOptions.find(({ id }) => id === item.name)?.label ?? item.name}
	class="mx-auto max-w-6xl space-y-2 overflow-y-auto p-1 pb-28"
/>
