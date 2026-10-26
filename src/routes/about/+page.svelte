<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import {
		checkForUpdate,
		getInstalledBuildTimestamp,
		needRefresh,
		updateApp,
		type UpdateCheckResult
	} from '#lib/services/pwaUpdate.svelte';
	import { RefreshCw } from '@lucide/svelte';

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
		<h1 class="text-5xl font-bold">Cashier Svelte</h1>
		<p>
			Cashier Svelte is a version of
			<a class="link link-primary" href="https://cashier.alensiljak.eu.org">Cashier</a>, built with
			Svelte.
		</p>

		<p>
			Cashier is a pocket helper for Plain-Text Accounting (PTA) systems, like Ledger CLI, Hledger,
			or Beancount. More on PTA at
			<a class="link link-primary" href="https://plaintextaccounting.org/">Plain Text Accounting</a
			>.
		</p>

		<p>
			It is used to write transaction records and transfer them to the full-blown personal finance
			system. It can also display the account and other useful information. For more detailed
			overview of the functionality, see the
			<a class="link link-primary" href="/help">Help</a> section.
		</p>

		<p>
			Cashier can also read your whole Beancount ledger. Use Ledger Import function to copy and
			regularly update your ledger data. Eventually export the Journal transactions created on your
			device and store them into your ledger files.
		</p>

		<h3 class="text-3xl font-semibold">Links</h3>
		<p>
			Repository: at
			<a class="link link-primary" href="https://github.com/alensiljak/cashier-svelte">GitHub</a>
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
				<a class="link link-primary" href="/ledger">Parsed Ledger</a>
			</li>
			<li>
				<a class="link link-primary" href="/ledger/multi">Parsed Multi Ledger</a>
			</li>
		</ul>
	</section>
</article>
