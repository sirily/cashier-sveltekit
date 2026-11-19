<script lang="ts">
	import { resolve } from '$app/paths';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import BoxIcon from '@lucide/svelte/icons/box';
	import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '#lib/settings';
	import Notifier from '#lib/utils/notifier';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import * as SyncBeancount from '#lib/sync/sync-beancount';
	import { syncFeedback } from '#lib/sync/sync-feedback.svelte';

	import { goto } from '$app/navigation';

	import { syncProgress } from '#lib/stores/syncProgressStore';

	Notifier.init();

	const DEFAULT_BEANCOUNT_ROOT_FILE = 'main.bean';

	let syncServerUrl = $state('');
	let syncApiToken = $state('');
	let syncBeancountRootFile = $state('');
	const diagnostics = $derived(syncFeedback.diagnostics);
	let rotationClass = $state('');
	const syncStarted = $derived(diagnostics !== null);
	let syncing = $state(false);

	function validateSyncServerUrl(rawUrl: string, notifyOnError = false) {
		const trimmedUrl = rawUrl.trim();

		if (!trimmedUrl) {
			if (notifyOnError) {
				Notifier.error('Cashier Server URL is required for synchronization.');
			}
			return null;
		}

		try {
			const url = new URL(trimmedUrl);

			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				if (notifyOnError) {
					Notifier.error('Cashier Server URL must be an absolute http:// or https:// URL.');
				}
				return null;
			}

			return url.toString();
		} catch {
			if (notifyOnError) {
				Notifier.error('Cashier Server URL must be an absolute http:// or https:// URL.');
			}
			return null;
		}
	}

	type SyncServerEntry = {
		id: string;
		name: string;
		url: string;
	};

	function safeServerId() {
		if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
			return crypto.randomUUID();
		}

		return `sync-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
	}

	function normalizeRootBookPath(path: string) {
		const trimmedPath = path.trim() || DEFAULT_BEANCOUNT_ROOT_FILE;
		if (trimmedPath === '/workspace/main.bean') return DEFAULT_BEANCOUNT_ROOT_FILE;
		if (trimmedPath.startsWith('/workspace/')) return trimmedPath.slice('/workspace/'.length);
		return trimmedPath;
	}

	async function syncStoredServerSelection(url: string) {
		const activeSyncServerId = await settings.get<string>(SettingKeys.syncActiveServerId);
		const syncServers = (await settings.get<SyncServerEntry[]>(SettingKeys.syncServers)) ?? [];
		if (activeSyncServerId) {
			const hasMatchingServer = syncServers.some((entry) => entry.id === activeSyncServerId);
			if (hasMatchingServer) {
				const updatedServers = syncServers.map((entry) =>
					entry.id === activeSyncServerId ? { ...entry, url } : entry
				);
				await settings.set(SettingKeys.syncServers, updatedServers);
				return;
			}
		}

		const existingServer = syncServers.find((entry) => entry.url === url);
		if (existingServer) {
			await settings.set(SettingKeys.syncActiveServerId, existingServer.id);
			return;
		}

		const newEntry = { id: safeServerId(), name: 'Default', url };
		await settings.set(SettingKeys.syncServers, [...syncServers, newEntry]);
		await settings.set(SettingKeys.syncActiveServerId, newEntry.id);
	}

	async function persistSyncServerUrl(notifyOnError = false) {
		const trimmedUrl = syncServerUrl.trim();
		syncServerUrl = trimmedUrl;

		if (!trimmedUrl) {
			if (notifyOnError) {
				validateSyncServerUrl(trimmedUrl, true);
				return null;
			}
			await settings.set(SettingKeys.syncServerUrl, null);
			await settings.set(SettingKeys.syncActiveServerId, null);
			await settings.set(SettingKeys.syncServerSelectionCleared, true);
			return null;
		}

		const validatedUrl = validateSyncServerUrl(trimmedUrl, notifyOnError);
		if (!validatedUrl) {
			return null;
		}

		syncServerUrl = validatedUrl;
		await settings.set(SettingKeys.syncServerUrl, validatedUrl);
		await settings.set(SettingKeys.syncServerSelectionCleared, false);
		await syncStoredServerSelection(validatedUrl);

		return validatedUrl;
	}

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		const storedSyncServerUrl = (await settings.get<string>(SettingKeys.syncServerUrl)) ?? '';
		const storedSyncApiToken = (await settings.get<string>(SettingKeys.syncApiToken)) ?? '';
		const storedRootFile = normalizeRootBookPath(
			(await settings.get<string>(SettingKeys.syncBeancountRootFile)) ?? DEFAULT_BEANCOUNT_ROOT_FILE
		);
		const activeSyncServerId = await settings.get<string>(SettingKeys.syncActiveServerId);
		const syncServers = (await settings.get<SyncServerEntry[]>(SettingKeys.syncServers)) ?? [];
		const activeStoredServer = activeSyncServerId
			? (syncServers.find((entry) => entry.id === activeSyncServerId) ?? null)
			: null;
		// `/sync` is the active server configuration UI, so it reads and writes the
		// canonical `syncServerUrl` directly instead of the dormant multi-server settings route.
		syncServerUrl = storedSyncServerUrl || activeStoredServer?.url || '';
		syncApiToken = storedSyncApiToken;
		syncBeancountRootFile = storedRootFile;
	}

	async function onOpfsClick() {
		// navigate to OPFS page
		await goto(resolve('/opfs'));
	}

	async function onSyncClicked() {
		const validatedUrl = await persistSyncServerUrl(true);
		if (!validatedUrl) return;

		syncBeancountRootFile = normalizeRootBookPath(syncBeancountRootFile);
		await settings.set(SettingKeys.syncBeancountRootFile, syncBeancountRootFile);

		Notifier.info('Synchronization starting...');

		syncing = true;

		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		try {
			const syncResult = await SyncBeancount.synchronize();

			if (!syncResult) {
				throw new Error(
					diagnostics?.lastError ??
						'Synchronization failed. Please check the logs for more details.'
				);
			}

			Notifier.success('Synchronization completed successfully!');
			rotationClass = '';
			syncing = false;
		} catch (error: any) {
			rotationClass = '';
			syncing = false;
			console.error(error);
			Notifier.error(error.message);
		}
	}

	async function saveSyncServerUrl() {
		await persistSyncServerUrl();
	}

	async function saveSyncApiToken() {
		syncApiToken = syncApiToken.trim();
		await settings.set(SettingKeys.syncApiToken, syncApiToken);
	}

	async function saveBeancountRootFile() {
		syncBeancountRootFile = normalizeRootBookPath(syncBeancountRootFile);
		await settings.set(SettingKeys.syncBeancountRootFile, syncBeancountRootFile);
	}
</script>

<Toolbar title="Server synchronization">
	{#snippet menuItems()}
		<ToolbarMenuItem text="OPFS Storage" Icon={BoxIcon} onclick={onOpfsClick} />
	{/snippet}
</Toolbar>

<main class="container mx-auto max-w-6xl space-y-4 p-1 lg:p-10">
	<div class="card bg-base-100 border border-base-300 shadow-sm">
		<div class="card-body gap-3 p-4">
			<p>
				Configure your Python Beancount server. Nothing is synchronized until you press Synchronize.
			</p>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Cashier Server URL</span></div>
				<input
					type="url"
					bind:value={syncServerUrl}
					onchange={saveSyncServerUrl}
					onblur={saveSyncServerUrl}
					class="input input-bordered w-full"
					placeholder="https://cashier.example.com/api"
				/>
			</label>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">API token</span></div>
				<input
					type="password"
					bind:value={syncApiToken}
					onchange={saveSyncApiToken}
					onblur={saveSyncApiToken}
					autocomplete="off"
					class="input input-bordered w-full"
					placeholder="Bearer token configured on Cashier Server"
				/>
			</label>
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Remote root book file</span></div>
				<input
					type="text"
					bind:value={syncBeancountRootFile}
					onchange={saveBeancountRootFile}
					onblur={saveBeancountRootFile}
					class="input input-bordered w-full"
					placeholder="main.bean"
				/>
			</label>
		</div>
	</div>

	{#snippet statusIcon(status: string | undefined)}
		{#if status === 'in-progress'}
			<span class="loading loading-spinner loading-sm"></span>
		{:else if status === 'completed'}
			<span class="text-success">✓</span>
		{:else if status === 'error'}
			<span class="text-error">✗</span>
		{:else}
			<span class="inline-block w-4"></span>
		{/if}
	{/snippet}

	<p>
		Synchronize sends completed local entries, downloads and validates the server book, then removes
		only confirmed local copies and refreshes the displayed book.
	</p>

	<table class="table table-zebra w-full table-raised border border-base-300 rounded-xl">
		<thead>
			<tr>
				<th>Send → pull → reconcile</th>
				{#if syncStarted}<th class="w-0.5">Status</th>{/if}
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>Send completed local transactions</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 0)?.status)}</td
					>{/if}
			</tr>
			<tr>
				<td>Download server book</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 6)?.status)}</td
					>{/if}
			</tr>
			<tr>
				<td>Select downloaded root book</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 7)?.status)}</td
					>{/if}
			</tr>
			<tr>
				<td>Validate downloaded server book</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 8)?.status)}</td
					>{/if}
			</tr>
			<tr>
				<td>Reconcile local journal</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 9)?.status)}</td
					>{/if}
			</tr>
			{#if diagnostics}
				<tr>
					<td>Refresh displayed book</td>
					<td>{diagnostics.refreshResult ?? '-'}</td>
				</tr>
			{/if}
		</tbody>
	</table>

	<center class="pt-10">
		<button
			class="btn bg-accent text-secondary rounded uppercase"
			onclick={onSyncClicked}
			disabled={syncing}
		>
			<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
			<span>Synchronize</span>
		</button>
	</center>

	{#if diagnostics?.syncErrors?.length}
		<div class="alert alert-error items-start shadow-sm" role="alert">
			<div>
				<h2 class="font-semibold">Synchronization has errors</h2>
				<ul class="mt-2 list-disc space-y-1 pl-5">
					{#each diagnostics.syncErrors as error, i (`${error.stage}:${error.message}:${i}`)}
						<li>
							<span class="font-medium">{error.stage}:</span>
							{#if error.cashierId}<code>{error.cashierId}</code> —
							{/if}
							{error.message}
						</li>
					{/each}
				</ul>
			</div>
		</div>
	{/if}

	{#if diagnostics}
		<div class="card bg-base-100 border border-base-300 shadow-sm">
			<div class="card-body p-4">
				<h2 class="card-title">Sync diagnostics</h2>
				<div class="grid grid-cols-2 gap-2 text-sm">
					<div>Ledger files</div>
					<div>{diagnostics.ledgerFilesCount ?? '-'}</div>
					<div>Selected root book</div>
					<div>{diagnostics.selectedRootBookFilename ?? '-'}</div>
					<div>Root book size</div>
					<div>{diagnostics.rootBookSize ?? '-'}</div>
					<div>Parse result</div>
					<div>{diagnostics.parseResult ?? '-'}</div>
					<div>Parse errors</div>
					<div>{diagnostics.parseErrorCount ?? '-'}</div>
					<div>Display refresh</div>
					<div>{diagnostics.refreshResult ?? '-'}</div>
					{#if diagnostics.lastError}
						<div>Last error</div>
						<div class="break-words">{diagnostics.lastError}</div>
					{/if}
					{#if diagnostics.parseErrors?.length}
						<div>Parse error details</div>
						<div class="space-y-1 break-words">
							{#each diagnostics.parseErrors as error, i (`${error}:${i}`)}
								<div>{error}</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</main>
