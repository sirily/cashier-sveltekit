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

	let syncAll = $state(false);
	let syncAccounts = $state(false);
	let syncAaValues = $state(false);
	let syncAssetAllocation = $state(false);
	let syncOpeningBalances = $state(false);
	let syncPayees = $state(false);

	let syncServerUrl = $state('');
	let rotationClass = $state('');
	let syncStarted = $state(false);
	let syncing = $state(false);
	let reloading = $state(false);

	let configSource = $state<LedgerDataSource>(LedgerDataSource.filesystem);

	function supportsOpeningBalancesSync() {
		return configSource === LedgerDataSource.filesystem;
	}

	function hasSelectedSyncStep() {
		return (
			syncAccounts ||
			(supportsOpeningBalancesSync() && syncOpeningBalances) ||
			syncAaValues ||
			syncAssetAllocation ||
			syncPayees
		);
	}

	function areAllVisibleSyncStepsSelected(visibleSteps: boolean[]) {
		return visibleSteps.length > 0 && visibleSteps.every(Boolean);
	}

	function recomputeSyncAll() {
		const visibleSteps = [syncAccounts, syncAaValues, syncAssetAllocation, syncPayees];
		if (supportsOpeningBalancesSync()) {
			visibleSteps.splice(1, 0, syncOpeningBalances);
		}

		syncAll = areAllVisibleSyncStepsSelected(visibleSteps);
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

	async function syncActiveStoredServerUrl(url: string) {
		const activeSyncServerId = await settings.get<string>(SettingKeys.syncActiveServerId);
		if (!activeSyncServerId) return;

		const syncServers = (await settings.get<SyncServerEntry[]>(SettingKeys.syncServers)) ?? [];
		const hasMatchingServer = syncServers.some((entry) => entry.id === activeSyncServerId);
		if (!hasMatchingServer) return;

		const updatedServers = syncServers.map((entry) =>
			entry.id === activeSyncServerId ? { ...entry, url } : entry
		);
		await settings.set(SettingKeys.syncServers, updatedServers);
	}

	async function persistSyncServerUrl(notifyOnError = false) {
		const trimmedUrl = syncServerUrl.trim();
		syncServerUrl = trimmedUrl;

		if (!trimmedUrl) {
			await settings.set(SettingKeys.syncServerUrl, trimmedUrl);
			await syncActiveStoredServerUrl(trimmedUrl);
			return null;
		}

		const validatedUrl = validateSyncServerUrl(trimmedUrl, notifyOnError);
		if (!validatedUrl) {
			return null;
		}

		syncServerUrl = validatedUrl;
		await settings.set(SettingKeys.syncServerUrl, validatedUrl);
		await syncActiveStoredServerUrl(validatedUrl);

		return validatedUrl;
	}

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		const dataSource = (await settings.get<string>(SettingKeys.ledgerDataSource)) ?? '';
		const storedSyncServerUrl = (await settings.get<string>(SettingKeys.syncServerUrl)) ?? '';
		if (dataSource) {
			configSource = dataSource as LedgerDataSource;
		} else {
			configSource = storedSyncServerUrl.trim()
				? LedgerDataSource.beancount
				: LedgerDataSource.filesystem;
		}
		// `/sync` is the active server configuration UI, so it reads and writes the
		// canonical `syncServerUrl` directly instead of the dormant multi-server settings route.
		syncServerUrl = storedSyncServerUrl;

		syncAccounts = (await settings.get(SettingKeys.syncAccounts)) ?? false;
		syncOpeningBalances = (await settings.get(SettingKeys.syncOpeningBalances)) ?? false;
		syncAaValues = (await settings.get(SettingKeys.syncAaValues)) ?? false;
		syncAssetAllocation = (await settings.get(SettingKeys.syncAssetAllocation)) ?? false;
		syncPayees = (await settings.get(SettingKeys.syncPayees)) ?? false;
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

		Notifier.info('Synchronization starting...');

		syncing = true;
		syncStarted = true;
		rotationClass = rotationClass == '' ? 'animate-[spin_2s_linear_infinite]' : '';

		try {
			const syncOptions: SyncBeancount.SyncSteps = {
				syncAccounts,
				syncOpeningBalances: supportsOpeningBalancesSync() ? syncOpeningBalances : false,
				syncAaValues,
				syncAssetAllocation,
				syncPayees
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
					break;
				case LedgerDataSource.rledger:
					// cashier-server-rust
					Notifier.warning(
						'Synchronization with Cashier Server (Rust Ledger) not implemented yet.'
					);
					break;
				case LedgerDataSource.ledger:
					Notifier.warning('Synchronization with Cashier Server (Ledger-cli) not implemented yet.');
					break;
			}

			if (!syncResult) {
				throw new Error('Synchronization failed. Please check the logs for more details.');
			}

			// invalidate cache and reload data
			await ledgerService.invalidate();

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
		recomputeSyncAll();
		await settings.set(SettingKeys.syncAccounts, syncAccounts);
		await settings.set(SettingKeys.syncOpeningBalances, syncOpeningBalances);
		await settings.set(SettingKeys.syncAaValues, syncAaValues);
		await settings.set(SettingKeys.syncAssetAllocation, syncAssetAllocation);
		await settings.set(SettingKeys.syncPayees, syncPayees);
	}

	async function saveDataSource() {
		await settings.set(SettingKeys.ledgerDataSource, configSource);
	}

	async function saveSyncServerUrl() {
		await persistSyncServerUrl();
	}

	async function toggleAllCheckboxes(checked: boolean) {
		syncAll = checked;
		syncAccounts = checked;
		if (supportsOpeningBalancesSync()) {
			syncOpeningBalances = checked;
		}
		syncAaValues = checked;
		syncAssetAllocation = checked;
		syncPayees = checked;

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
