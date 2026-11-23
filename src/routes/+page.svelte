<script lang="ts">
	import { resolve } from '$app/paths';
	import JournalCard from '#lib/components/JournalCard.svelte';
	import ArrowDownUpIcon from '@lucide/svelte/icons/arrow-down-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import Toolbar from '../lib/components/Toolbar.svelte';
	import { goto } from '$app/navigation';
	import { xact, xactSpan } from '#lib/data/mainStore';
	import { Xact } from '#lib/data/model';
	import AccountGroupsCard from '#lib/components/AccountGroupsCard.svelte';
	import SyncCard from '#lib/components/SyncCard.svelte';

	import { onMount, type Component } from 'svelte';
	import Fab from '#lib/components/FAB.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import { CardNames, SettingKeys, settings } from '#lib/settings';
	import appService from '#lib/services/appService';
	import { parseSyncServerUrl, syncAction } from '#lib/sync/sync-action.svelte';

	let cards: Array<Component> = $state([]);

	onMount(async () => {
		// display the cards ordered.
		await loadCardList();
	});

	async function loadCardList() {
		let cardsOrder = await appService.getVisibleCards();

		cardsOrder.forEach((name: string) => {
			let card;
			switch (name) {
				case CardNames.AccountGroupsCard:
					card = AccountGroupsCard;
					break;

				case CardNames.JournalCard:
					card = JournalCard;
					break;

				case CardNames.SyncCard:
					card = SyncCard;
					break;
			}
			if (card) {
				cards.push(card);
			}
		});
	}

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

	<!-- Main -->
	<section class="container mx-auto flex max-w-full flex-col gap-2 px-1 pt-1 pb-28 lg:max-w-screen-sm">
		<!-- Cards are displayed dynamically, in the selected order. -->
		{#each cards as Card, index (index)}
			<Card></Card>
		{/each}

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
	</section>
</article>
