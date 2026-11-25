<script lang="ts">
	import { resolve } from '$app/paths';
	import HomeCardTemplate from '#lib/components/HomeCardTemplate.svelte';
	import ReportLinks from '#lib/components/ReportLinks.svelte';
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

	import { onMount } from 'svelte';
	import Fab from '#lib/components/FAB.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import { HomeCardNames } from '#lib/enums';
	import { homeShortcuts } from '#lib/navigation';
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

	<!-- Main -->
	<section class="container mx-auto flex max-w-full flex-col gap-2 px-1 pt-1 pb-28 lg:max-w-screen-sm">
		<!-- Cards are displayed dynamically, in the selected order. -->
		{#each visibleCards as id, index (index)}
			{@const shortcut = homeShortcuts.find((item) => item.id === id)}
			{#if id === HomeCardNames.ACCOUNT_GROUPS}
				<AccountGroupsCard />
			{:else if id === HomeCardNames.JOURNAL}
				<JournalCard />
			{:else if shortcut?.path === '/reports'}
				<HomeCardTemplate>
					{#snippet icon()}
						<shortcut.Icon aria-hidden="true" />
					{/snippet}
					{#snippet title()}
						<a href={resolve(shortcut.path)} class="hover:underline">{shortcut.label}</a>
					{/snippet}
					{#snippet content()}
						<div class="grid gap-2 px-1 sm:grid-cols-2">
							<ReportLinks />
						</div>
					{/snippet}
				</HomeCardTemplate>
			{:else if shortcut}
				<a
					href={resolve(shortcut.path)}
					class="card bg-base-100 hover:bg-base-200 focus-visible:outline-accent"
				>
					<span class="flex min-h-12 items-center gap-3 px-3 py-2 text-lg">
						<shortcut.Icon aria-hidden="true" />
						{shortcut.label}
					</span>
				</a>
			{/if}
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
