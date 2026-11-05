<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import Fab from '#lib/components/FAB.svelte';
	import { xact, xactSpan, selectionMetadata } from '#lib/data/mainStore';
	import { Posting, Xact } from '#lib/data/model';
	import { SelectionModeMetadata } from '#lib/settings';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import appService from '#lib/services/appService';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CalculatorIcon from '@lucide/svelte/icons/calculator';
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import Big from 'big.js';
	import { ensureInitialized, createParsedLedger } from '#lib/services/rustledger';
	import { xactToBeancountText } from '#lib/utils/xactUtils';

	const accountName = $derived(page.url.searchParams.get('account') ?? '');

	let balances = $state<Record<string, number> | null>(null);
	let baselineError = $state('Loading account balances…');
	const currency = $derived(($xact?.postings[0]?.currency ?? '').trim().toUpperCase());
	// Python Beancount lexer.l CURRENCY rules, including the single-letter CAPITAL token.
	const validCurrency = $derived(
		/^(?:[A-Z](?:[A-Z0-9._'-]*[A-Z0-9])?|\/[A-Z0-9._'-]*[A-Z](?:[A-Z0-9._'-]*[A-Z0-9])?)$/.test(
			currency
		)
	);
	const ledgerBalance = $derived(balances && validCurrency ? (balances[currency] ?? 0) : null);
	let enteredBalance = $state('');
	let ready = $state(false);
	let checking = $state(false);
	let compatibilityError = $state('');
	let active = true;
	onDestroy(() => {
		active = false;
	});

	onMount(async () => {
		const previous = get(xact);
		if ($selectionMetadata?.origin === 'bal-adj') {
			// Returning from account or calculator selection — restore saved state
			const meta = $selectionMetadata;
			selectionMetadata.set(undefined);

			if ($xact?.note) {
				const [savedBalance] = $xact.note.split('|');
				enteredBalance = savedBalance ?? '';

				$xact.note = '';
			}

			if (meta.selectionType === 'account' && meta.selectedId) {
				$xact.postings[0].account = meta.selectedId as string;
			} else if (meta.selectionType === 'amount' && meta.selectedId !== undefined) {
				enteredBalance = String(meta.selectedId);
			}
			await loadBalances(previous);
			if (active && get(xact) === previous) ready = true;
			return;
		}

		// Normal initialisation: build the xact and load the ledger balance
		const tx = new Xact();
		tx.date = new Date().toISOString().substring(0, 10);
		tx.payee = 'Balance Adjustment';
		tx.flag = '*';
		tx.postings = [new Posting(), new Posting()];
		tx.postings[1].account = accountName;

		const defaultCurrency = await appService.getDefaultCurrency();
		if (!active || get(xact) !== previous) return;
		tx.postings[0].currency = defaultCurrency;

		xactSpan.set(undefined);
		xact.set(tx);
		await loadBalances(tx);
		if (!active || get(xact) !== tx) return;
		if (balances) {
			$xact.postings[0].currency = Object.keys(balances)[0] ?? defaultCurrency;
			enteredBalance = String(balances[$xact.postings[0].currency] ?? 0);
		}
		ready = true;
	});

	async function loadBalances(owner: Xact) {
		balances = null;
		try {
			if (!accountName) throw new Error('No account selected.');
			await fullLedgerService.ensureLoaded();
			if ((await fullLedgerService.getErrors()).length)
				throw new Error('Resolve ledger diagnostics before adjusting a balance.');
			const accounts = await fullLedgerService.getAllAccounts();
			if (!accounts.some((account) => account.name === accountName))
				throw new Error('Account is not available in the local book.');
			const result = await fullLedgerService.query(
				`SELECT sum(number) AS balance, currency WHERE account = '${accountName.replaceAll("'", "\\'")}' GROUP BY currency ORDER BY currency`
			);
			if (result.errors.length) throw new Error('The balance query failed.');
			const amountIndex = result.columns.indexOf('balance');
			const currencyIndex = result.columns.indexOf('currency');
			if (amountIndex < 0 || currencyIndex < 0)
				throw new Error('The balance query returned incomplete data.');
			const current: Record<string, number> = {};
			for (const row of result.rows as unknown[][]) {
				const amount = row[amountIndex];
				const currency = row[currencyIndex];
				if (
					amount == null ||
					amount === '' ||
					!Number.isFinite(Number(amount)) ||
					typeof currency !== 'string' ||
					!currency
				)
					throw new Error('An account balance is unresolved.');
				current[currency] = Number(amount);
			}
			if (!active || get(xact) !== owner) return;
			balances = current;
			baselineError = '';
		} catch (error) {
			if (!active || get(xact) !== owner) return;
			baselineError = `Balance unavailable. ${error instanceof Error ? error.message : 'Reload the local book and retry.'}`;
		}
	}

	/** Persist current form values into xact.note before leaving this page. */
	function saveState() {
		if ($xact) $xact.note = `${enteredBalance}|${ledgerBalance}`;
	}

	async function selectExpenseAccount() {
		saveState();
		const meta = new SelectionModeMetadata();
		meta.origin = 'bal-adj';
		meta.selectionType = 'account';
		selectionMetadata.set(meta);
		await goto(resolve('/accounts'));
	}

	async function openCalculator() {
		saveState();
		const meta = new SelectionModeMetadata();
		meta.origin = 'bal-adj';
		meta.selectionType = 'amount';
		meta.initialValue = parseFloat(enteredBalance) || 0;
		selectionMetadata.set(meta);
		await goto(resolve('/calculator'));
	}

	async function onFab() {
		if (!$xact || ledgerBalance === null || checking) return;
		const entered = parseFloat(enteredBalance);
		if (!Number.isFinite(entered)) return;

		const owner = get(xact);
		const snapshot = JSON.stringify(owner);
		const target = enteredBalance;
		const candidate: Xact = JSON.parse(snapshot);
		candidate.note = '';
		candidate.postings[0].currency = currency;
		candidate.postings[0].amount = new Big(ledgerBalance).minus(entered).toNumber();
		candidate.postings[1].amount = -candidate.postings[0].amount;
		candidate.postings[1].currency = currency;
		candidate.postings[1].account = accountName;
		const source = xactToBeancountText(candidate);
		const ownsForm = () =>
			active &&
			get(xact) === owner &&
			JSON.stringify(owner) === snapshot &&
			enteredBalance === target;
		checking = true;
		compatibilityError = '';
		try {
			await ensureInitialized();
			if (!ownsForm()) return;
			const parsed = createParsedLedger(source);
			if (!parsed) throw new Error('Parser unavailable');
			try {
				const directives = parsed.getDirectives();
				const transaction = directives[0];
				if (
					parsed.getParseErrors().length ||
					directives.length !== 1 ||
					transaction.type !== 'transaction' ||
					transaction.postings.length !== candidate.postings.length
				)
					throw new Error('Round-trip mismatch');
				for (const [index, posting] of transaction.postings.entries()) {
					const expected = candidate.postings[index];
					if (
						posting.account !== expected.account ||
						!posting.units ||
						posting.units.currency !== expected.currency ||
						!new Big(posting.units.number).eq(expected.amount!)
					)
						throw new Error('Round-trip mismatch');
				}
			} finally {
				parsed.free();
			}
			if (!ownsForm()) return;
			xact.set(candidate);
			await goto(resolve('/tx'));
		} catch {
			if (ownsForm())
				compatibilityError =
					'The local engine cannot safely represent this adjustment. The journal is unchanged. Choose a supported commodity or update the local engine; valid Beancount syntax alone does not guarantee compatibility.';
		} finally {
			checking = false;
		}
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Balance Adjustment" />

	<section class="container mx-auto flex-1 overflow-y-auto p-4 space-y-4 lg:max-w-screen-sm">
		{#if ready && !checking && ledgerBalance !== null}<Fab Icon={CheckIcon} onclick={onFab} />{/if}
		{#if baselineError}<p role="alert">{baselineError}</p>{/if}
		{#if compatibilityError}<p role="alert">{compatibilityError}</p>{/if}
		{#if ready && !validCurrency}<p role="alert">
				Enter a valid commodity: start with a letter or slash, include a letter, and end with a
				letter or digit. Periods, underscores, hyphens and apostrophes are allowed only inside.
				Letters are normalized to uppercase.
			</p>{/if}

		{#if $xact}
			<fieldset disabled={!ready || checking} class="space-y-4">
				<!-- Account being balanced (informational) -->
				<div class="form-control">
					<label class="label" for="account">
						<span class="label-text">Account</span>
					</label>
					<input
						id="account"
						type="text"
						class="input input-bordered w-full"
						value={accountName}
						readonly
					/>
				</div>

				<!-- Ledger balance (informational) -->
				<div class="form-control">
					<div class="label">
						<span class="label-text">Ledger Balance</span>
					</div>
					<div class="input input-bordered flex items-center opacity-60">
						{ledgerBalance ?? 'Unavailable'}
						<span class="ml-2 text-sm">{currency}</span>
					</div>
				</div>

				<!-- Current (actual) balance — primary action field -->
				<div class="form-control">
					<label class="label" for="entered-balance">
						<span class="label-text font-semibold">Current Balance</span>
					</label>
					<div class="flex gap-1 items-center">
						<input
							id="entered-balance"
							type="number"
							step="0.01"
							class="input bg-primary/20 flex-1"
							bind:value={enteredBalance}
							placeholder="0.00"
						/>
						<button
							type="button"
							class="btn btn-outline w-12 shrink-0 rounded px-1"
							onclick={openCalculator}
							title="Open calculator"
						>
							<CalculatorIcon />
						</button>
						<input
							type="text"
							class="input bg-primary/20 w-20 text-center uppercase"
							bind:value={$xact.postings[0].currency}
							placeholder="EUR"
						/>
					</div>
				</div>

				<!-- Difference (calculated) -->
				{#if enteredBalance !== '' && ledgerBalance !== null}
					{@const diff = parseFloat(enteredBalance) - ledgerBalance}
					{#if !isNaN(diff) && diff !== 0}
						<div class="form-control">
							<div class="label">
								<span class="label-text">Difference</span>
							</div>
							<div
								class="input input-bordered flex items-center {diff < 0
									? 'text-error'
									: 'text-success'}"
							>
								{diff > 0 ? '+' : ''}{diff.toFixed(2)}
								<span class="ml-2 text-sm">{currency}</span>
							</div>
						</div>
					{/if}
				{/if}

				<!-- Expense account — tap to select from account list -->
				<div class="form-control">
					<label class="label" for="expense-account">
						<span class="label-text font-semibold">Expense Account</span>
					</label>
					<input
						id="expense-account"
						type="text"
						class="input bg-primary/20 w-full"
						bind:value={$xact.postings[0].account}
						placeholder="Expenses:Adjustment"
						readonly
						onclick={selectExpenseAccount}
					/>
				</div>
			</fieldset>
		{:else}
			<div class="flex h-full items-center justify-center">
				<span class="loading loading-spinner loading-lg"></span>
			</div>
		{/if}
	</section>
</article>
