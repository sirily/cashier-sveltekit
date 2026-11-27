<script lang="ts">
	import ReferenceList from './ReferenceList.svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';
	import {
		readCalculatorAccounts,
		readCalculatorBalances,
		type CalculatorBalance
	} from '#lib/services/calculatorBalances';

	let { account, onselect, oncancel }: {
		account?: string;
		onselect: (balance: CalculatorBalance & { account: string }) => void;
		oncancel: () => void;
	} = $props();

	let chosen = $state<string>();
	const selected = $derived(account || chosen);
	const request = new ReportRequest<CalculatorBalance[]>();
	const version = fullLedgerService.version;
	const reloading = fullLedgerService.isReloading;
	let dialog: HTMLDialogElement;

	$effect(() => {
		dialog.showModal();
	});

	$effect(() => {
		const name = selected;
		const current = $version;
		if (!name || $reloading) return;
		void request.run(() => readCalculatorBalances(name), () =>
			name === selected && current === $version && !$reloading
		);
		return () => request.cancel();
	});
</script>

<dialog class="modal modal-bottom sm:modal-middle" aria-label="Insert account balance" bind:this={dialog} onclose={oncancel}>
	<div class="modal-box space-y-3">
		<div class="flex items-center justify-between gap-2">
			<h2 class="text-lg font-semibold">Insert account balance</h2>
			<button type="button" class="btn btn-sm btn-ghost" onclick={() => dialog.close()}>Cancel</button>
		</div>
		{#if selected}
			<div class="flex flex-wrap items-center gap-2">
				{#if !account}
					<button type="button" class="btn btn-sm" onclick={() => (chosen = undefined)}>Change account</button>
				{/if}
				<strong class="break-all">{selected}</strong>
			</div>
			{#if request.pending || $reloading}
				<p role="status">Loading balances…</p>
			{:else if request.error}
				<p role="alert">Balance unavailable: {request.error}</p>
			{:else if !request.value?.length}
				<p>No balances for this account in the local book.</p>
			{:else}
				<p class="text-sm opacity-75">Choose a balance in its original currency. No conversion is applied.</p>
				<ul aria-label="Balances">
					{#each request.value as balance (balance.currency)}
						<li>
							<button type="button" class="btn btn-ghost w-full justify-start font-mono" onclick={() => onselect({ ...balance, account: selected })}>
								{balance.amount} {balance.currency}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<ReferenceList label="Accounts" focus read={readCalculatorAccounts} name={(name) => name}>
				{#snippet row(name)}
					<button type="button" class="btn btn-ghost h-auto min-h-10 w-full justify-start py-2 text-left break-all" onclick={() => (chosen = name)}>{name}</button>
				{/snippet}
			</ReferenceList>
		{/if}
	</div>
	<form method="dialog" class="modal-backdrop">
		<button aria-label="Dismiss balance picker">close</button>
	</form>
</dialog>
