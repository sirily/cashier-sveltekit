<script lang="ts">
	import { resolve } from '$app/paths';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import BoxIcon from '@lucide/svelte/icons/box';
	import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '#lib/settings';
	import Notifier from '#lib/utils/notifier';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import { parseSyncServerUrl, syncAction } from '#lib/sync/sync-action.svelte';
	import SyncStatus from '#lib/components/SyncStatus.svelte';
	import { goto } from '$app/navigation';

	Notifier.init();

	const DEFAULT_BEANCOUNT_ROOT_FILE = 'main.bean';

	let syncServerUrl = $state('');
	let syncApiToken = $state('');
	let syncBeancountRootFile = $state('');

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
				Notifier.error('Cashier Server URL is required for synchronization.');
				return null;
			}
			await settings.set(SettingKeys.syncServerUrl, null);
			await settings.set(SettingKeys.syncActiveServerId, null);
			await settings.set(SettingKeys.syncServerSelectionCleared, true);
			return null;
		}

		const validatedUrl = parseSyncServerUrl(trimmedUrl);
		if (!validatedUrl) {
			if (notifyOnError) {
				Notifier.error('Cashier Server URL must be an absolute http:// or https:// URL.');
			}
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
		// Prefer the saved URL; use the legacy selection only to prefill a missing URL.
		syncServerUrl = storedSyncServerUrl || activeStoredServer?.url || '';
		syncApiToken = storedSyncApiToken;
		syncBeancountRootFile = storedRootFile;
	}

	async function onOpfsClick() {
		// navigate to OPFS page
		await goto(resolve('/opfs'));
	}

	async function onSyncClicked() {
		await syncAction.run(async () => {
			if (!(await persistSyncServerUrl(true))) return false;
			await saveBeancountRootFile();
			return true;
		});
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

	<SyncStatus secret={syncApiToken}>
		{#snippet action()}
			<center class="pt-10">
				<button
					class="btn bg-accent text-secondary rounded uppercase"
					onclick={onSyncClicked}
					disabled={syncAction.running}
					aria-busy={syncAction.running}
				>
					<RefreshCcw class={syncAction.running ? 'motion-safe:animate-spin' : ''} />
					<span>Synchronize</span>
				</button>
			</center>
		{/snippet}
	</SyncStatus>
</main>
