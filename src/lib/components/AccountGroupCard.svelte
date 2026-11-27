<script lang="ts">
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import HomeCardTemplate from './HomeCardTemplate.svelte';
	import AccountRow from './AccountRow.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Big from 'big.js';
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { Account, Money } from '#lib/data/model';
	import type { AccountGroup } from '#lib/settings';
	import appService from '#lib/services/appService';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { reportDiagnostic } from '#lib/services/reportPostings';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';

	type Props = {
		group: AccountGroup;
		index: number;
		onAccountClick?: (accountName: string) => void;
	};
	let { group, index, onAccountClick }: Props = $props();

	const lsVersion = fullLedgerService.version;
	const isReloading = fullLedgerService.isReloading;
	const request = new ReportRequest<{ accounts: Account[]; version: number }>();
	const pending = $derived(
		request.pending ||
			$isReloading ||
			(request.value !== null && request.value.version !== $lsVersion)
	);
	const maxBalance = $derived(
		request.value?.accounts.reduce(
			(max, account) => Math.max(max, Math.abs(account.balance?.quantity ?? 0)),
			0
		) ?? 0
	);

	$effect(() => {
		const names = [...group.accounts];
		const version = $lsVersion;
		const reloading = $isReloading;
		untrack(() => {
			if (names.length === 0 || reloading) {
				request.cancel();
				return;
			}
			void request.run(
				async () => ({ accounts: await loadData(names), version }),
				() => !$isReloading && $lsVersion === version
			);
		});
		return () => request.cancel();
	});

	async function loadData(names: string[]): Promise<Account[]> {
		const defaultCurrency = await appService.getDefaultCurrency();
		const quotedNames = names.map((name) => `'${name}'`).join(', ');
		const result = await fullLedgerService.query(
			`SELECT account, sum(position) AS balance WHERE account IN (${quotedNames})`
		);
		if (result.errors.length > 0) throw new Error(result.errors.map(reportDiagnostic).join('; '));

		const accountIdx = result.columns.indexOf('account');
		const balanceIdx = result.columns.indexOf('balance');
		if (accountIdx < 0 || balanceIdx < 0) throw new Error('Unexpected balance query result.');

		const balanceMap = new SvelteMap<string, Record<string, number>>();
		for (const row of result.rows) {
			if (!Array.isArray(row) || typeof row[accountIdx] !== 'string') {
				throw new Error('Unexpected balance query row.');
			}
			balanceMap.set(row[accountIdx], extractBalances(row[balanceIdx]));
		}

		return names.map((name) => {
			const balances = balanceMap.get(name);
			const account = new Account(name);
			account.exists = balances !== undefined;
			account.balances = balances;
			account.balance = new Money();
			account.balance.currency =
				balances && !(defaultCurrency in balances)
					? (Object.keys(balances)[0] ?? defaultCurrency)
					: defaultCurrency;
			account.balance.quantity = balances?.[account.balance.currency] ?? 0;
			return account;
		});
	}

	function extractBalances(cell: any): Record<string, number> {
		const balances: Record<string, number> = {};
		if (!cell || typeof cell !== 'object') return balances;
		if (Array.isArray(cell.positions)) {
			const totals = new SvelteMap<string, Big>();
			for (const pos of cell.positions) {
				const units = pos?.units;
				if (!units?.currency || units.number == null) continue;
				const amount = new Big(units.number);
				totals.set(units.currency, totals.get(units.currency)?.plus(amount) ?? amount);
			}
			return Object.fromEntries(
				[...totals].map(([currency, amount]) => [currency, amount.toNumber()])
			);
		}
		if (cell.units?.currency && cell.units.number != null) {
			balances[cell.units.currency] = parseFloat(cell.units.number);
			return balances;
		}
		if (cell.currency && cell.number != null) balances[cell.currency] = parseFloat(cell.number);
		return balances;
	}

	function onSettingsClick(e: Event) {
		e.stopPropagation();
		goto(resolve('/accounts/groups/[index]', { index: String(index) }));
	}
</script>

<HomeCardTemplate headerStyle={group.color ? `background-color: ${group.color}` : undefined}>
	{#snippet title()}
		{group.title}
	{/snippet}
	{#snippet menu()}
		<button
			type="button"
			class="btn btn-ghost btn-circle btn-sm {group.color
				? 'text-base-content/70'
				: 'text-primary-content'}"
			onclick={onSettingsClick}
			aria-label="Group settings"
		>
			<Settings2Icon size={16} />
		</button>
	{/snippet}
	{#snippet content()}
		{#if group.accounts.length === 0}
			<p class="px-2 py-1 text-sm opacity-60">No accounts added</p>
		{:else if pending}
			<p role="status" class="px-2 py-1 text-sm">Loading balances…</p>
		{:else if request.error}
			<div role="alert" class="alert alert-error m-1 text-sm">
				<p class="break-words"><strong>Balances unavailable.</strong> {request.error}</p>
			</div>
		{:else if request.value}
			{#each request.value.accounts as account (account.name)}
				<AccountRow {account} balancesLoaded={true} {maxBalance} onclick={onAccountClick} />
			{/each}
		{/if}
	{/snippet}
</HomeCardTemplate>
