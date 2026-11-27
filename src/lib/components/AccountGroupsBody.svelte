<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { SettingKeys, settings, type AccountGroup } from '#lib/settings';
	import AccountGroupCard from './AccountGroupCard.svelte';

	// If the host owns the groups, it also owns any writes or initialization.
	let { groups }: { groups?: AccountGroup[] | null } = $props();
	let saved = $state<AccountGroup[] | null>(null);
	let readFailed = $state(false);
	const visibleGroups = $derived(groups === undefined ? saved : groups);

	onMount(() => {
		if (groups !== undefined) return;
		let active = true;
		void settings.get<AccountGroup[]>(SettingKeys.accountGroups).then(
			(result) => {
				if (active) saved = result ?? [];
			},
			() => {
				if (active) readFailed = true;
			}
		);
		return () => {
			active = false;
		};
	});

	function openAccount(accountName: string) {
		return goto(
			resolve('/accounts/account-xacts/[accountName]', {
				accountName: encodeURIComponent(accountName)
			})
		);
	}
</script>

{#if readFailed}
	<p role="alert" class="px-2 py-1 text-sm">Could not read account groups.</p>
{:else if !visibleGroups}
	<p role="status" class="px-2 py-1 text-sm">Loading account groups…</p>
{:else if visibleGroups.length === 0}
	<p class="px-2 py-1 text-sm">No groups configured. Open Account Groups to get started.</p>
{:else}
	<div class="flex flex-col gap-2 px-1">
		{#each visibleGroups as group, index (index)}
			<AccountGroupCard {group} {index} onAccountClick={openAccount} />
		{/each}
	</div>
{/if}
