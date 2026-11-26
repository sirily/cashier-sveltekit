<script lang="ts">
	import { resolve } from '$app/paths';
	import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';
	import ArrowDownUpIcon from '@lucide/svelte/icons/arrow-down-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import Toolbar from '../lib/components/Toolbar.svelte';
	import { goto } from '$app/navigation';
	import { xact, xactSpan } from '#lib/data/mainStore';
	import { Xact } from '#lib/data/model';

	import { onMount } from 'svelte';
	import Fab from '#lib/components/FAB.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import { SettingKeys, settings } from '#lib/settings';
	import appService from '#lib/services/appService';
	import { parseSyncServerUrl, syncAction } from '#lib/sync/sync-action.svelte';

	let visibleCards = $state<string[]>([]);

	onMount(async () => {
		visibleCards = await appService.getVisibleCards();
	});

	async function onSynchronize() {
		await syncAction.run(async () => {
			const serverUrl = (await settings.get<string>(SettingKeys.syncServerUrl)) ?? '';
			if (parseSyncServerUrl(serverUrl)) return true;

			await goto(resolve('/sync'));
			return false;
		});
	}

	async function onFab() {
		// create a new transaction in the app store
		const tx = Xact.create();
		xact.set(tx);
		xactSpan.set(undefined);

		await goto(resolve('/tx'));
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar>
		{#snippet menuItems()}
			<ToolbarMenuItem
				text="Home Settings"
				Icon={SettingsIcon}
				targetNav={resolve('/home-settings')}
			/>
			<ToolbarMenuItem
				text="Reorder Cards"
				targetNav={resolve('/home-reorder')}
				Icon={ArrowDownUpIcon}
			/>
		{/snippet}
	</Toolbar>

	<section
		aria-label="Home cards"
		class="container mx-auto flex max-w-full flex-col gap-2 px-1 pt-1 pb-28 lg:max-w-screen-sm"
	>
		<HomeSectionCards cards={visibleCards} />
	</section>

	<div class="relative z-5">
		<button
			type="button"
			class="btn btn-neutral fixed right-24 bottom-7 h-14 gap-2 rounded-full px-4 shadow-lg"
			onclick={onSynchronize}
			disabled={syncAction.running}
			aria-busy={syncAction.running}
		>
			<RefreshCcwIcon class={syncAction.running ? 'motion-safe:animate-spin' : ''} size={20} />
			<span>Synchronize</span>
		</button>
		<Fab onclick={onFab} Icon={PlusIcon} label="New transaction" />
	</div>
</article>
