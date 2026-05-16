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
	let syncPayees = $state(false);
	let syncOpeningBalances = $state(false);

	let syncServerUrl = $state('');
	let rotationClass = $state('');
	let syncStarted = $state(false);
	let syncing = $state(false);

	let configSource = $state<LedgerDataSource>(LedgerDataSource.filesystem);

	function hasSelectedSyncStep() {
		return (
			syncAccounts ||
			syncAaValues ||
			syncPayees ||
			syncOpeningBalances
		);
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

	async function persistSyncServerUrl(notifyOnError = false) {
		const trimmedUrl = syncServerUrl.trim();
		syncServerUrl = trimmedUrl;

		if (!trimmedUrl) {
			await settings.set(SettingKeys.syncServerUrl, trimmedUrl);
			return null;
		}

		const validatedUrl = validateSyncServerUrl(trimmedUrl, notifyOnError);
		if (validatedUrl) {
			syncServerUrl = validatedUrl;
		}

		await settings.set(SettingKeys.syncServerUrl, syncServerUrl);

		return validatedUrl;
	}

	onMount(async () => {
		await loadSettings();
	});

	async function loadSettings() {
		const dataSource = (await settings.get<string>(SettingKeys.ledgerDataSource)) ?? '';
		if (dataSource) {
			configSource = dataSource as LedgerDataSource;
		} else {
			await settings.set(SettingKeys.ledgerDataSource, configSource);
		}
		// `/sync` is the active server configuration UI, so it reads and writes the
		// canonical `syncServerUrl` directly instead of the dormant multi-server settings route.
		syncServerUrl = (await settings.get<string>(SettingKeys.syncServerUrl)) ?? '';

		syncAccounts = (await settings.get(SettingKeys.syncAccounts)) ?? false;
		syncAaValues = (await settings.get(SettingKeys.syncAaValues)) ?? false;
		syncPayees = (await settings.get(SettingKeys.syncPayees)) ?? false;
		syncOpeningBalances = (await settings.get(SettingKeys.syncOpeningBalances)) ?? false;
		await settings.set(SettingKeys.syncAssetAllocation, false);
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
				syncAaValues,
				syncAssetAllocation: false,
				syncPayees,
				syncOpeningBalances
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
		if (configSource !== LedgerDataSource.beancount) return;

		const activeUrl = await persistSyncServerUrl(true);
		if (!activeUrl) return;

		const sync = new SyncBeancount.CashierSyncBeancount(activeUrl);
		await sync.reloadData();
	}

	async function saveSettings() {
		await settings.set(SettingKeys.syncAccounts, syncAccounts);
		await settings.set(SettingKeys.syncOpeningBalances, syncOpeningBalances);
		await settings.set(SettingKeys.syncAaValues, syncAaValues);
		await settings.set(SettingKeys.syncPayees, syncPayees);
		await settings.set(SettingKeys.syncAssetAllocation, false);
	}

	async function saveDataSource() {
		await settings.set(SettingKeys.ledgerDataSource, configSource);
	}

	async function saveSyncServerUrl() {
		await persistSyncServerUrl();
	}

	type VisibleSyncSetting = 'syncAccounts' | 'syncAaValues' | 'syncPayees' | 'syncOpeningBalances';

	async function toggleSetting(key: VisibleSyncSetting) {
		switch (key) {
			case 'syncAccounts':
				syncAccounts = !syncAccounts;
				break;
			case 'syncAaValues':
				syncAaValues = !syncAaValues;
				break;
			case 'syncPayees':
				syncPayees = !syncPayees;
				break;
			case 'syncOpeningBalances':
				syncOpeningBalances = !syncOpeningBalances;
				break;
		}

		await saveSettings();
	}

	function toggleAllCheckboxes(checked: boolean) {
		syncAll = checked;
		syncAccounts = checked;
		syncAaValues = checked;
		syncPayees = checked;
		syncOpeningBalances = checked;

		saveSettings();
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
						onchange={(e) => toggleAllCheckboxes(e.target?.checked)}
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
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAccounts}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => toggleSetting('syncAccounts')} class="cursor-pointer">
					Accounts
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 1)?.status)}</td>{/if}
			</tr>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncOpeningBalances}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => toggleSetting('syncOpeningBalances')} class="cursor-pointer">
					Opening balances
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 2)?.status)}</td>{/if}
			</tr>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncAaValues}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => toggleSetting('syncAaValues')} class="cursor-pointer">
					Account current values (for asset allocation)
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 3)?.status)}</td>{/if}
			</tr>
			<tr>
				<td>
					<input
						class="checkbox checkbox-primary rounded"
						type="checkbox"
						bind:checked={syncPayees}
						onchange={saveSettings}
					/>
				</td>
				<td onclick={() => toggleSetting('syncPayees')} class="cursor-pointer">
					Payees
				</td>
				{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 4)?.status)}</td>{/if}
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
			<button class="btn bg-primary text-accent rounded uppercase" onclick={reloadData}>
				<span><RefreshCcw class={rotationClass} style="animation-direction: reverse;" /></span>
				<span>Reload Data</span>
			</button>
		</center>
	{/if}

</main>
