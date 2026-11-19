<script lang="ts">
	import { xact, selectionMetadata } from '#lib/data/mainStore';
	import CalculatorIcon from '@lucide/svelte/icons/calculator';
	import DiffIcon from '@lucide/svelte/icons/diff';
	import { onMount } from 'svelte';
	import type { EventHandler } from 'svelte/elements';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SelectionModeMetadata } from '#lib/settings';
	import { postingAmountText, setPostingAmount } from '#lib/utils/postingWeights';

	type Props = {
		index: number;
		// posting?: Posting;
		onAccountClicked?: EventHandler;
		onAmountChanged?: () => void;
	};
	let {
		index,
		// posting = $bindable(),
		onAccountClicked,
		onAmountChanged
	}: Props = $props();

	let amountInput: HTMLInputElement;
	let amountFieldColor = $derived(
		($xact?.postings[index].amount as number) < 0 ? 'bg-secondary/20' : 'bg-primary/20'
	);
	let currencyInput: HTMLInputElement;

	onMount(() => {});

	/**
	 * Open calculator to enter amount
	 */
	async function openCalculator() {
		// Set selection mode for amount calculation
		const meta = new SelectionModeMetadata();
		meta.postingIndex = index;
		meta.selectionType = 'amount';

		// Store the current amount value to initialize the calculator
		const currentAmount = $xact.postings[index].amount;
		if (currentAmount !== undefined && currentAmount !== null) {
			meta.initialValue = currentAmount;
		}

		selectionMetadata.set(meta);

		// Navigate to calculator
		await goto(resolve('/calculator'));
	}

	/**
	 * Change amount sign.
	 */
	function changeSign() {
		const posting = $xact.postings[index];
		const amount = postingAmountText(posting);
		if (amount !== undefined) {
			const flipped = amount.startsWith('-') ? amount.slice(1) : `-${amount.replace(/^\+/, '')}`;
			setPostingAmount(posting, flipped);
			xact.update((tx) => tx);
		}

		if (onAmountChanged) {
			onAmountChanged();
		}
	}
</script>

<section class="w-full">
	<input
		title="Account"
		placeholder="Account"
		type="text"
		class="input w-full rounded"
		readonly
		bind:value={$xact.postings[index].account}
		onclick={onAccountClicked}
	/>

	<div class="mb-2 flex flex-row items-center">
		<!-- amount sign -->
		<div>
			<button
				type="button"
				class="btn btn-outline btn-primary-content w-12 grow-0 rounded px-1"
				onclick={changeSign}
			>
				<DiffIcon />
			</button>
		</div>
		<input
			title="Amount"
			placeholder="Amount"
			type="text"
			inputmode="decimal"
			class={`input grow text-right text-lg ${amountFieldColor} rounded`}
			value={postingAmountText($xact.postings[index]) ?? $xact.postings[index].amountText ?? ''}
			bind:this={amountInput}
			onfocus={() => amountInput.select()}
			oninput={(event) => {
				setPostingAmount($xact.postings[index], event.currentTarget.value);
				xact.update((tx) => tx);
				onAmountChanged?.();
			}}
		/>
		<!-- calculator button -->
		<button
			type="button"
			class="btn btn-outline btn-primary-content w-12 grow-0 rounded px-1 mx-1"
			onclick={openCalculator}
			title="Open calculator"
		>
			<CalculatorIcon />
		</button>
		<input
			title="Currency"
			placeholder="Currency"
			type="text"
			class="input rounded text-center uppercase w-22 p-1"
			bind:value={$xact.postings[index].currency}
			bind:this={currencyInput}
			onfocus={() => currencyInput.select()}
			oninput={() =>
				($xact.postings[index].currency = $xact.postings[index].currency?.toUpperCase())}
		/>
	</div>
</section>
