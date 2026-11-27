<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { drawerState } from '#lib/data/mainStore';
	import { drawerGroups, footerLinks, primaryLinks, type DrawerLink } from '#lib/navigation';

	function closeDrawer(): void {
		drawerState.set(false);
	}
</script>

{#snippet navLinks(links: readonly DrawerLink[])}
	{#each links as { path, label, Icon } (path)}
		<li>
			<a
				href={resolve(path)}
				class="flex w-full items-center gap-2 py-2 {page.url.pathname === path
					? 'active bg-secondary text-secondary-content'
					: ''}"
				onclick={closeDrawer}
			>
				<Icon />
				<span>{label}</span>
			</a>
		</li>
	{/each}
{/snippet}

<div class="bg-base-200 flex h-screen flex-col">
	<div class="bg-primary w-full p-4">
		<div class="flex w-full items-center justify-center">
			<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
		</div>
		<div class="pt-2 text-center">
			<p class="text-2xl font-semibold">Cashier</p>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<ul class="menu menu-lg w-full">
			{@render navLinks(primaryLinks)}
		</ul>

		<div class="divider divider-primary m-1"></div>

		<ul class="menu menu-lg w-full">
			{#each drawerGroups as { label, Icon, links } (label)}
				<li>
					<details>
						<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
							<Icon size={22} />
							<span>{label}</span>
							<span class="flex-1"></span>
						</summary>
						<ul>
							{@render navLinks(links)}
						</ul>
					</details>
				</li>
			{/each}
		</ul>

		<div class="divider divider-primary m-1"></div>

		<ul class="menu menu-lg w-full">
			{@render navLinks(footerLinks)}
		</ul>
	</div>
</div>
