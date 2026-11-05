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
			This Beancount client-server fork is based on
			<a class="link link-primary" href="https://cashier.alensiljak.eu.org">Cashier</a>, built with
			Svelte.
		</p>

		<p>
			Capture manual transactions in the device Journal, including while offline.
			More on plain-text accounting at
			<a class="link link-primary" href="https://plaintextaccounting.org/">Plain Text Accounting</a
			>.
		</p>

		<p>
			Explicit Server Sync sends completed local entries to the authoritative Python Beancount
			server, downloads the book, and removes local copies only after confirmation.
			For setup and daily use, see the
			<a class="link link-primary" href={resolve("/help")}>Help</a> section.
		</p>

		<p>
			RustLedger calculates balances, account history and reports locally from the downloaded
			book and pending Journal, even offline. Journal export is optional; it does not synchronize
			or remove local entries.
		</p>

		<h3 class="text-3xl font-semibold">Links</h3>
		<p>
			Repository: at
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

		<h3 class="text-3xl font-semibold">Experiments</h3>

		<ul>
			<li>
				<a class="link link-primary" href={resolve("/ledger")}>Parsed Ledger</a>
			</li>
			<li>
				<a class="link link-primary" href={resolve("/ledger/multi")}>Parsed Multi Ledger</a>
			</li>
		</ul>
	</section>
</article>
