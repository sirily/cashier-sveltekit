<script lang="ts">
	import { resolve } from '$app/paths';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import {
		checkForUpdate,
		getInstalledBuildTimestamp,
		needRefresh,
		updateApp,
		type UpdateCheckResult
	} from '#lib/services/pwaUpdate.svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	let checking = $state(false);
	let updateResult = $state<UpdateCheckResult | undefined>(undefined);
	let installedBuild = $state<string | undefined>(undefined);

	$effect(() => {
		void getInstalledBuildTimestamp().then((timestamp) => (installedBuild = timestamp));
	});

	async function checkForUpdates() {
		checking = true;
		updateResult = undefined;
		try {
			updateResult = await checkForUpdate();
		} finally {
			checking = false;
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="About"></Toolbar>

	<section class="space-y-4 p-1">
		<h1 class="text-5xl font-bold">Cashier</h1>
		<p>
			Cashier is a personal finance assistant for Beancount. Capture transactions, review your
			accounts, and explore reports on your device, including while offline.
		</p>

		<p>
			Keep entries in your local Journal and use Server Sync when you are ready to send completed
			transactions and refresh your book. For setup and daily use, see
			<a class="link link-primary" href={resolve('/help')}>Help</a>.
		</p>

		<p>
			Learn about keeping your accounts in text files at
			<a class="link link-primary" href="https://plaintextaccounting.org/">Plain Text Accounting</a
			>.
		</p>

		<h3 class="text-3xl font-semibold">Links</h3>
		<p>
			Source code and project documentation:
			<a class="link link-primary" href="https://github.com/sirily/cashier-sveltekit">GitHub</a>
		</p>

		<h3 class="text-3xl font-semibold">Version</h3>
		<p>
			Build: <code>{installedBuild ?? __BUILD_TIMESTAMP__}</code>
		</p>
		<p>
			<button
				class="link link-primary inline-flex items-center gap-1"
				onclick={checkForUpdates}
				disabled={checking}
			>
				<RefreshCw size={14} class={checking ? 'animate-spin' : ''} />
				{checking ? 'Checking…' : 'Check for updates'}
			</button>
		</p>
		{#if updateResult === 'latest' && !needRefresh.value}
			<p>You are on the latest version.</p>
		{:else if updateResult === 'available' || needRefresh.value}
			<p>A new version is available.</p>
			<button class="btn btn-sm btn-primary" onclick={updateApp}>Update</button>
		{:else if updateResult === 'unavailable'}
			<p>Update checking is unavailable.</p>
		{:else if updateResult === 'error'}
			<p>Could not check for updates.</p>
		{/if}

		<h3 class="text-3xl font-semibold">Credits and license</h3>
		<p>
			With thanks to the <a class="link link-primary" href="https://cashier.alensiljak.eu.org"
				>Cashier contributors</a
			>. Cashier is free software under the
			<a
				class="link link-primary"
				href="https://github.com/sirily/cashier-sveltekit/blob/main/LICENSE"
				>GNU Affero General Public License v3</a
			>.
		</p>
	</section>
</article>
