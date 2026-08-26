<script lang="ts">
	import Toolbar from '$lib/components/Toolbar.svelte';
	import { BoxIcon, RefreshCcw } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SettingKeys, settings } from '$lib/settings';
	import Notifier from '$lib/utils/notifier';
	import ToolbarMenuItem from '$lib/components/ToolbarMenuItem.svelte';
	import * as SyncBeancount from '$lib/sync/sync-beancount';
	import { LedgerDataSource } from '$lib/enums';
	import { goto } from '$app/navigation';
	import * as cashierFsSync from '$lib/sync/sync-fs';
	import ledgerService from '$lib/services/ledgerService';
	import { syncProgress } from '$lib/stores/syncProgressStore';

	Notifier.init();
	const PENDING_SYNC_SOURCE_STORAGE_KEY = 'cashier.pendingSyncDataSource';

	let syncAll = $state(false);
	let syncAccounts = $state(false);
	let syncAaValues = $state(false);
	let syncAssetAllocation = $state(false);
	let syncOpeningBalances = $state(false);
	let syncPayees = $state(false);
	let syncLedgerFiles = $state(false);

	const DEFAULT_BEANCOUNT_ROOT_FILE = 'main.bean';

	let syncServerUrl = $state('');
	let syncBeancountRootFile = $state('');
	let diagnostics = $state<SyncBeancount.BeancountSyncDiagnostics | null>(null);
	let rotationClass = $state('');
	let syncStarted = $state(false);
	let syncing = $state(false);
	let reloading = $state(false);

	let configSource = $state<LedgerDataSource>(LedgerDataSource.filesystem);

	function supportsOpeningBalancesSync() {
		return configSource === LedgerDataSource.filesystem;
	}

	function supportsCurrentValuesSync() {
		return configSource === LedgerDataSource.filesystem;
	}

	function supportsAssetAllocationSync() {
		return configSource === LedgerDataSource.filesystem;
	}

	function hasSelectedSyncStep() {
		return (
			syncAccounts ||
			(supportsOpeningBalancesSync() && syncOpeningBalances) ||
			(supportsCurrentValuesSync() && syncAaValues) ||
			(supportsAssetAllocationSync() && syncAssetAllocation) ||
			syncPayees ||
			syncLedgerFiles
		);
	}

	function areAllVisibleSyncStepsSelected(visibleSteps: boolean[]) {
		return visibleSteps.length > 0 && visibleSteps.every(Boolean);
	}

	function recomputeSyncAll() {
		const visibleSteps = [syncAccounts, syncPayees];
		if (supportsOpeningBalancesSync()) {
			visibleSteps.splice(1, 0, syncOpeningBalances);
		}
		if (supportsCurrentValuesSync()) {
			visibleSteps.splice(visibleSteps.length - 1, 0, syncAaValues);
		}
		if (supportsAssetAllocationSync()) {
			visibleSteps.splice(visibleSteps.length - 1, 0, syncAssetAllocation);
		}
		if (configSource === LedgerDataSource.beancount) {
			visibleSteps.push(syncLedgerFiles);
		}

		syncAll = areAllVisibleSyncStepsSelected(visibleSteps);
	}

	function clearUnsupportedSyncSteps() {
		if (!supportsOpeningBalancesSync()) syncOpeningBalances = false;
		if (!supportsCurrentValuesSync()) syncAaValues = false;
		if (!supportsAssetAllocationSync()) syncAssetAllocation = false;
		if (configSource !== LedgerDataSource.beancount) syncLedgerFiles = false;
	}

	function validateSyncServerUrl(rawUrl: string, notifyOnError = false) {
		const trimmedUrl = rawUrl.trim();

		if (!trimmedUrl) {
			if (notifyOnError) {
				Notifier.error('Cashier Server URL is required for the Beancount data source.');
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

	function getPendingSyncSource() {
		if (typeof localStorage === 'undefined') return null;

		const source = localStorage.getItem(PENDING_SYNC_SOURCE_STORAGE_KEY);
		return source === LedgerDataSource.beancount ? LedgerDataSource.beancount : null;
	}

	function setPendingSyncSource(source: LedgerDataSource | null) {
		if (typeof localStorage === 'undefined') return;

		if (source) {
			localStorage.setItem(PENDING_SYNC_SOURCE_STORAGE_KEY, source);
		} else {
			localStorage.removeItem(PENDING_SYNC_SOURCE_STORAGE_KEY);
		}
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
			await settings.set(SettingKeys.syncServerUrl, trimmedUrl || null);
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
		if (configSource === LedgerDataSource.beancount) {
			await settings.set(SettingKeys.ledgerDataSource, LedgerDataSource.beancount);
			setPendingSyncSource(null);
		}

		return validatedUrl;
	}

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		const dataSource = (await settings.get<string>(SettingKeys.ledgerDataSource)) ?? '';
		const storedSyncServerUrl = (await settings.get<string>(SettingKeys.syncServerUrl)) ?? ''; 
		const storedRootFile = normalizeRootBookPath(
			(await settings.get<string>(SettingKeys.syncBeancountRootFile)) ?? DEFAULT_BEANCOUNT_ROOT_FILE
		);
		const activeSyncServerId = await settings.get<string>(SettingKeys.syncActiveServerId);
		const syncServers = (await settings.get<SyncServerEntry[]>(SettingKeys.syncServers)) ?? [];
		const activeStoredServer = activeSyncServerId
			? syncServers.find((entry) => entry.id === activeSyncServerId) ?? null
			: null;
		if (dataSource) {
			configSource = dataSource as LedgerDataSource;
		} else {
			configSource = getPendingSyncSource() ?? LedgerDataSource.filesystem;
		}
		// `/sync` is the active server configuration UI, so it reads and writes the
		// canonical `syncServerUrl` directly instead of the dormant multi-server settings route.
		syncServerUrl = storedSyncServerUrl || activeStoredServer?.url || '';
		syncBeancountRootFile = storedRootFile;
		await settings.set(SettingKeys.syncBeancountRootFile, storedRootFile);

		syncAccounts = (await settings.get(SettingKeys.syncAccounts)) ?? false;
		syncOpeningBalances = (await settings.get(SettingKeys.syncOpeningBalances)) ?? false;
		syncAaValues = (await settings.get(SettingKeys.syncAaValues)) ?? false;
		syncAssetAllocation = (await settings.get(SettingKeys.syncAssetAllocation)) ?? false;
		syncPayees = (await settings.get(SettingKeys.syncPayees)) ?? false;
		syncLedgerFiles =
			((await settings.get<boolean>(SettingKeys.syncLedgerFiles)) ?? false) &&
			configSource === LedgerDataSource.beancount;
		clearUnsupportedSyncSteps();
		recomputeSyncAll();
	}

	async function onOpfsClick() {
		// navigate to OPFS page
		await goto('/opfs');
	}

	async function onSyncClicked() {
		if (!hasSelectedSyncStep()) {
			Notifier.error('Select at least one synchronization step before starting sync.');
			return;
		}

		if (configSource === LedgerDataSource.beancount) {
			const validatedUrl = await persistSyncServerUrl(true);

			if (!validatedUrl) return;
		}

		if (configSource === LedgerDataSource.beancount) {
			syncBeancountRootFile = normalizeRootBookPath(syncBeancountRootFile);
			await settings.set(SettingKeys.syncBeancountRootFile, syncBeancountRootFile);
		}

		Notifier.info('Synchronization starting...');

		diagnostics = null;
		syncing = true;
		syncStarted = true;
		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		try {
			clearUnsupportedSyncSteps();
			const syncOptions: SyncBeancount.SyncSteps = {
				syncAccounts,
				syncOpeningBalances: supportsOpeningBalancesSync() ? syncOpeningBalances : false,
				syncAaValues: supportsCurrentValuesSync() ? syncAaValues : false,
				syncAssetAllocation: supportsAssetAllocationSync() ? syncAssetAllocation : false,
				syncPayees,
				syncLedgerFiles: configSource === LedgerDataSource.beancount ? syncLedgerFiles : false
			};

			let syncResult = false;
			// check which backend to synchronize with.
			switch (configSource) {
				case LedgerDataSource.filesystem:
					syncResult = await cashierFsSync.synchronize(syncOptions);
					break;
				case LedgerDataSource.beancount:
					// cashier-server-python
					syncResult = await SyncBeancount.synchronize(syncOptions);
					diagnostics = SyncBeancount.getLastDiagnostics();
					break;
				case LedgerDataSource.ledger:
					Notifier.warning('Synchronization with Cashier Server (Ledger-cli) not implemented yet.');
					break;
			}

			if (!syncResult) {
				throw new Error(
					diagnostics?.lastError ?? 'Synchronization failed. Please check the logs for more details.'
				);
			}

			if (configSource === LedgerDataSource.filesystem) {
				await ledgerService.invalidate();
			} else if (configSource === LedgerDataSource.beancount) {
				diagnostics = SyncBeancount.getLastDiagnostics();
			}

			Notifier.success(
				configSource === LedgerDataSource.beancount && !syncOptions.syncLedgerFiles
					? 'Metadata synchronization completed successfully.'
					: 'Synchronization completed successfully!'
			);
			rotationClass = '';
			syncing = false;
		} catch (error: any) {
			if (configSource === LedgerDataSource.beancount) {
				diagnostics = SyncBeancount.getLastDiagnostics();
			}
			rotationClass = '';
			syncing = false;
			console.error(error);
			Notifier.error(error.message);
		}
	}

	async function reloadData() {
		if (configSource !== LedgerDataSource.beancount || reloading) return;

		const activeUrl = await persistSyncServerUrl(true);
		if (!activeUrl) return;

		reloading = true;

		try {
			const sync = new SyncBeancount.CashierSyncBeancount(activeUrl);
			await sync.reloadData();
			Notifier.success('Data reloaded successfully!');
		} catch (error: any) {
			console.error(error);
			Notifier.error(error.message || 'Failed to reload data.');
		} finally {
			reloading = false;
		}
	}

	async function saveSettings() {
		clearUnsupportedSyncSteps();
		recomputeSyncAll();
		await settings.set(SettingKeys.syncAccounts, syncAccounts);
		await settings.set(SettingKeys.syncOpeningBalances, syncOpeningBalances);
		await settings.set(SettingKeys.syncAaValues, syncAaValues);
		await settings.set(SettingKeys.syncAssetAllocation, syncAssetAllocation);
		await settings.set(SettingKeys.syncPayees, syncPayees);
		await settings.set(SettingKeys.syncLedgerFiles, syncLedgerFiles);
	}

	async function saveDataSource() {
		clearUnsupportedSyncSteps();
		if (configSource === LedgerDataSource.beancount) {
			const hasUrl = !!syncServerUrl.trim();
			if (!hasUrl) {
				setPendingSyncSource(LedgerDataSource.beancount);
				recomputeSyncAll();
				return;
			}

			const previousDataSource =
				(await settings.get<LedgerDataSource>(SettingKeys.ledgerDataSource)) ?? LedgerDataSource.filesystem;
			await settings.set(SettingKeys.ledgerDataSource, configSource);
			if (hasUrl) {
				const validatedUrl = await persistSyncServerUrl(true);
				if (!validatedUrl) {
					configSource = previousDataSource;
					await settings.set(SettingKeys.ledgerDataSource, configSource);
					setPendingSyncSource(null);
					recomputeSyncAll();
					return;
				}
			}
		} else {
			await settings.set(SettingKeys.ledgerDataSource, configSource);
			setPendingSyncSource(null);
		}

		recomputeSyncAll();
	}

	async function saveSyncServerUrl() {
		await persistSyncServerUrl();
	}

	async function saveBeancountRootFile() {
		syncBeancountRootFile = normalizeRootBookPath(syncBeancountRootFile);
		await settings.set(SettingKeys.syncBeancountRootFile, syncBeancountRootFile);
	}

	async function toggleAllCheckboxes(checked: boolean) {
		syncAll = checked;
		syncAccounts = checked;
		if (supportsOpeningBalancesSync()) {
			syncOpeningBalances = checked;
		}
		if (supportsCurrentValuesSync()) {
			syncAaValues = checked;
		}
		if (supportsAssetAllocationSync()) {
			syncAssetAllocation = checked;
		}
		syncPayees = checked;
		if (configSource === LedgerDataSource.beancount) {
			syncLedgerFiles = checked;
		}
		clearUnsupportedSyncSteps();

		await saveSettings();
	}

	function onToggleAllChange(event: Event) {
		toggleAllCheckboxes((event.currentTarget as HTMLInputElement).checked);
	}
</script>

<Toolbar title="Synchronization">
	{#snippet menuItems()}
		<ToolbarMenuItem text="OPFS Storage" Icon={BoxIcon} onclick={onOpfsClick} />
	{/snippet}
</Toolbar>

<main class="container mx-auto max-w-6xl space-y-4 p-1 lg:p-10">
	<div class="card bg-base-100 border border-base-300 shadow-sm">
		<div class="card-body gap-3 p-4">
			<label class="form-control w-full">
				<div class="label"><span class="label-text">Data source</span></div>
				<select bind:value={configSource} onchange={saveDataSource} class="select select-bordered w-full">
					<option value={LedgerDataSource.filesystem}>Filesystem</option>
					<option value={LedgerDataSource.beancount}>Beancount</option>
				</select>
			</label>
			{#if configSource === LedgerDataSource.beancount}
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
			{/if}
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

	<table class="table table-zebra w-full table-raised border border-base-300 rounded-xl">
		<thead>
			<tr>
				<th class="w-0.5">
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAll}
						onchange={onToggleAllChange}
					/>
				</th>
				<th>Data type</th>
				{#if syncStarted}<th class="w-0.5"></th>{/if}
			</tr>
		</thead>
		<tbody>
			<tr>
				<td>
					<input
						id="sync-accounts"
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAccounts}
						onchange={saveSettings}
					/>
				</td>
				<td>
					<label for="sync-accounts" class="block cursor-pointer py-3">Accounts</label>
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 1)?.status)}</td>{/if}
			</tr>
			{#if supportsOpeningBalancesSync()}
				<tr>
					<td>
						<input
							id="sync-opening-balances"
							class="checkbox checkbox-primary rounded"
							type="checkbox"
							bind:checked={syncOpeningBalances}
							onchange={saveSettings}
						/>
					</td>
					<td>
						<label for="sync-opening-balances" class="block cursor-pointer py-3"
							>Opening balances</label
						>
					</td>
					{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 2)?.status)}</td>{/if}
				</tr>
			{/if}
			{#if supportsCurrentValuesSync()}
			<tr>
				<td>
					<input
						id="sync-aa-values"
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAaValues}
						onchange={saveSettings}
					/>
				</td>
				<td>
					<label for="sync-aa-values" class="block cursor-pointer py-3"
						>Account current values (for asset allocation)</label
					>
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 4)?.status)}</td>{/if}
			</tr>
			{/if}
			{#if supportsAssetAllocationSync()}
			<tr>
				<td>
					<input
						id="sync-asset-allocation"
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAssetAllocation}
						onchange={saveSettings}
					/>
				</td>
				<td>
					<label for="sync-asset-allocation" class="block cursor-pointer py-3"
						>Asset allocation definition</label
					>
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 3)?.status)}</td>{/if}
			</tr>
			{/if}
			<tr>
				<td>
					<input
						id="sync-payees"
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncPayees}
						onchange={saveSettings}
					/>
				</td>
				<td>
					<label for="sync-payees" class="block cursor-pointer py-3">Payees</label>
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 5)?.status)}</td>{/if}
			</tr>
			{#if configSource === LedgerDataSource.beancount}
				<tr>
					<td></td>
					<td>Send local transactions</td>
					{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 0)?.status)}</td>{/if}
				</tr>
				<tr>
					<td>
						<input
							id="sync-ledger-files"
							class="checkbox checkbox-primary rounded"
							type="checkbox"
							bind:checked={syncLedgerFiles}
							onchange={saveSettings}
						/>
					</td>
					<td>
						<label for="sync-ledger-files" class="block cursor-pointer py-3">Ledger files to OPFS</label>
					</td>
					{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 6)?.status)}</td>{/if}
				</tr>
				<tr>
					<td></td>
					<td>Root book selected</td>
					{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 7)?.status)}</td>{/if}
				</tr>
				<tr>
					<td></td>
					<td>Full ledger parsed</td>
					{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 8)?.status)}</td>{/if}
				</tr>
				<tr>
					<td></td>
					<td>Reconcile local journal</td>
					{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 9)?.status)}</td>{/if}
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
					{#each diagnostics.syncErrors as error}
						<li>
							<span class="font-medium">{error.stage}:</span> {error.message}
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
					<div>Sync mode</div><div>{diagnostics.syncMode ?? '-'}</div>
					<div>Accounts</div><div>{diagnostics.accountsCount ?? '-'}</div>
					<div>Payees</div><div>{diagnostics.payeesCount ?? '-'}</div>
					<div>Ledger files</div><div>{diagnostics.ledgerFilesCount ?? '-'}</div>
					<div>Selected root book</div><div>{diagnostics.selectedRootBookFilename ?? '-'}</div>
					<div>Root book size</div><div>{diagnostics.rootBookSize ?? '-'}</div>
					<div>Parse result</div><div data-testid="sync-parse-result">{diagnostics.parseResult ?? '-'}</div>
					<div>Parse errors</div><div>{diagnostics.parseErrorCount ?? '-'}</div>
					{#if diagnostics.lastError}
						<div>Last error</div><div class="break-words">{diagnostics.lastError}</div>
					{/if}
					{#if diagnostics.parseErrors?.length}
						<div>Parse error details</div>
						<div class="space-y-1 break-words">
							{#each diagnostics.parseErrors as error}
								<div>{error}</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if configSource === LedgerDataSource.beancount}
		<hr class="my-10" />

		<center>
			<button
				class="btn bg-primary text-accent rounded uppercase"
				onclick={reloadData}
				disabled={reloading}
			>
				<span
					><RefreshCcw
						class={reloading ? 'animate-[spin_2s_linear_infinite]' : ''}
						style="animation-direction: reverse;"
					/></span
				>
				<span>Reload Data</span>
			</button>
		</center>
	{/if}

</main>
