<script lang="ts">
	import Fab from '#lib/components/FAB.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { homeCardOptions } from '#lib/navigation';
	import appService from '#lib/services/appService';
	import { SettingKeys, settings } from '#lib/settings';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let savedCards: string[] = [];
	let selectedCards = $state<SvelteSet<string> | null>(null);

	onMount(async () => {
		savedCards = await appService.getVisibleCards();
		selectedCards = new SvelteSet(savedCards);
	});

	function toggleCard(id: string, checked: boolean) {
		if (!selectedCards) return;
		if (checked) selectedCards.add(id);
		else selectedCards.delete(id);
	}

	async function saveSettings() {
		const selected = selectedCards;
		if (!selected) return;
		await settings.set(SettingKeys.visibleCards, [
			...savedCards.filter((id) => selected.has(id)),
			...[...selected].filter((id) => !savedCards.includes(id))
		]);
		history.back();
	}
</script>

<Toolbar title="Home Settings" />

<Fab Icon={CheckIcon} label="Save Home Settings" onclick={saveSettings} />

<section class="p-1 pb-28">
	<h3 class="h3">Show Cards:</h3>

	<fieldset class="flex flex-col space-y-4 p-4" disabled={selectedCards === null}>
		{#each homeCardOptions as { id, label } (id)}
			<label class="flex items-center space-x-2">
				<input
					class="checkbox checkbox-primary"
					type="checkbox"
					checked={selectedCards?.has(id) ?? false}
					onchange={(event) => toggleCard(id, event.currentTarget.checked)}
				/>
				<span>{label}</span>
			</label>
		{/each}
	</fieldset>
</section>
