<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import LandmarkIcon from '@lucide/svelte/icons/landmark';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import { onMount } from 'svelte';
	import { SettingKeys, settings, type AccountGroup } from '#lib/settings';
	import AccountGroupCard from './AccountGroupCard.svelte';
	import HomeCardTemplate from './HomeCardTemplate.svelte';

	let groups = $state<AccountGroup[] | null>(null);

	onMount(async () => {
		groups = (await settings.get<AccountGroup[]>(SettingKeys.accountGroups)) ?? [];
	});

	function openAccount(accountName: string) {
		return goto(
			resolve('/accounts/account-xacts/[accountName]', { accountName: encodeURIComponent(accountName) })
		);
	}
</script>

<HomeCardTemplate>
	{#snippet icon()}
		<LandmarkIcon />
	{/snippet}
	{#snippet title()}
		Account Groups
	{/snippet}
	{#snippet menu()}
		<a
			href={resolve('/accounts/groups')}
			class="btn btn-ghost btn-circle btn-sm text-primary-content"
			aria-label="Manage account groups"
		>
			<Settings2Icon size={16} />
		</a>
	{/snippet}
	{#snippet content()}
		{#if groups?.length === 0}
			<p class="px-2 py-1 text-sm">No groups configured. Use Manage account groups to get started.</p>
		{:else if groups}
			<div class="flex flex-col gap-2 px-1">
				{#each groups as group, index (index)}
					<AccountGroupCard {group} {index} onAccountClick={openAccount} />
				{/each}
			</div>
		{/if}
	{/snippet}
</HomeCardTemplate>
