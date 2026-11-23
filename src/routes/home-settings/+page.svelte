<script lang="ts">
	import Fab from '#lib/components/FAB.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { HomeCardNames } from '#lib/enums';
	import appService from '#lib/services/appService';
	import { SettingKeys, settings } from '#lib/settings';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { onMount } from 'svelte';

	let visibleCards: string[] = $state([]);
	let showAccountGroups = $state(false);

	let _showJournal = $state(false);

	onMount(async () => {
		await loadData();
	});

	/**
	 * Show the selected item.
	 * @param item The name of the card to have displayed.
	 */
	function includeItem(item: string) {
		if (!visibleCards.includes(item)) {
			visibleCards.push(item);
		}
	}

	async function loadData() {
		visibleCards = await appService.getVisibleCards();

		// check the items that are selected on the list.
		showAccountGroups = visibleCards.includes(HomeCardNames.ACCOUNT_GROUPS);

		if (visibleCards.includes(HomeCardNames.JOURNAL)) {
			_showJournal = true;
		}
	}

	async function onFabClicked() {
		await saveSettings();
	}

	function removeItem(item: string): void {
		const index = visibleCards.indexOf(item);
		if (index > -1) {
			visibleCards.splice(index, 1);
		}
	}

	async function saveSettings() {
		if (showAccountGroups) {
			includeItem(HomeCardNames.ACCOUNT_GROUPS);
		} else {
			visibleCards = visibleCards.filter((name) => name !== HomeCardNames.ACCOUNT_GROUPS);
		}

		if (_showJournal) {
			includeItem(HomeCardNames.JOURNAL);
		} else {
			removeItem(HomeCardNames.JOURNAL);
		}

		await settings.set(SettingKeys.visibleCards, visibleCards);

		history.back();
	}
</script>

<Toolbar title="Home Settings" />

<Fab Icon={CheckIcon} onclick={onFabClicked} />

<section class="p-1">
	<h3 class="h3">Show Cards:</h3>

	<div class="flex flex-col space-y-4 p-4">
		<label class="flex items-center space-x-2">
			<input class="checkbox checkbox-primary" type="checkbox" bind:checked={showAccountGroups} />
			<p>Account Groups</p>
		</label>

		<label class="flex items-center space-x-2">
			<input class="checkbox checkbox-primary" type="checkbox" bind:checked={_showJournal} />
			<p>Journal</p>
		</label>
	</div>
</section>
