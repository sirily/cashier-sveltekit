<script lang="ts">
	import type { Snippet } from 'svelte';
	import CalculatorBalancePicker from './CalculatorBalancePicker.svelte';
	import { Calculator } from '#lib/utils/calculator.svelte';

	let { initialValue, account, onapply, actions }: {
		initialValue?: string;
		account?: string;
		onapply?: (value: string | undefined) => void;
		actions?: Snippet<[apply: () => void]>;
	} = $props();
	const calculator = new Calculator();
	let picking = $state(false);

	$effect(() => {
		calculator.reset(initialValue);
	});

	function indexLabel(index: number) {
		return calculator.tokens.slice(0, index + 1).filter((token) => typeof token === 'object').length;
	}

	function apply() {
		onapply?.(calculator.amountToApply());
	}
</script>

<div
	class="mx-auto w-full max-w-xs rounded-2xl border-2 border-gray-500 bg-gradient-to-b from-gray-400 to-gray-600 p-5 shadow-2xl"
>
	<!-- Calculator Display -->
	<div class="mb-4 rounded-lg border border-gray-700 bg-black p-4 shadow-inner">
		<div
			class="min-h-6 overflow-x-auto text-right font-mono text-sm whitespace-nowrap text-green-400"
		>
			{#each calculator.tokens as token, index (index)}
				{#if typeof token === 'object'}
					<button
						type="button"
						class="min-h-11 min-w-11 rounded px-1 hover:underline aria-pressed:bg-primary aria-pressed:text-primary-content"
						aria-label={`Select operand ${indexLabel(index)}: ${token.amount}${token.currency ? ` ${token.currency}` : ''}`}
						aria-pressed={calculator.selected === index}
						title={token.account}
						onclick={() => calculator.select(index)}
					>{token.amount}{token.currency ? ` ${token.currency}` : ''}</button>
				{:else}
					<span>{token}</span>
				{/if}
			{/each}
		</div>
		<div
			role="status"
			aria-label="Calculator result"
			class="mt-1 overflow-x-auto text-right font-mono text-3xl font-bold whitespace-nowrap text-green-400"
		>
			{calculator.display}
		</div>
	</div>

	<!-- Calculator Buttons -->
	<div class="grid grid-cols-4 gap-2 [&>button]:min-w-0 [&>button]:px-1">
		<button
			class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			onclick={() => calculator.reset()}
		>
			AC
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			onclick={() => calculator.parenthesis('(')}
		>
			(
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			onclick={() => calculator.parenthesis(')')}
		>
			)
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			onclick={() => calculator.backspace()}
		>
			⌫
		</button>

		<button
			type="button"
			class="btn btn-lg bg-primary flex items-center justify-center rounded-lg border border-gray-900 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			aria-label="Insert account balance"
			title="Insert account balance"
			onclick={() => (picking = true)}
		>
			<img src="/icons/cashier-logo.svg" alt="" width="32" height="32" />
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			onclick={() => calculator.toggleSign()}
		>
			+/-
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-500 bg-gray-300 text-lg font-bold text-gray-800 shadow-md hover:bg-gray-400"
			onclick={() => calculator.percent()}
		>
			%
		</button>
		<button
			class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
			onclick={() => calculator.operator('÷')}
		>
			÷
		</button>

		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('7')}
		>
			7
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('8')}
		>
			8
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('9')}
		>
			9
		</button>
		<button
			class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
			onclick={() => calculator.operator('×')}
		>
			×
		</button>

		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('4')}
		>
			4
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('5')}
		>
			5
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('6')}
		>
			6
		</button>
		<button
			class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
			onclick={() => calculator.operator('+')}
		>
			+
		</button>

		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('1')}
		>
			1
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('2')}
		>
			2
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('3')}
		>
			3
		</button>
		<button
			class="btn btn-lg rounded-lg border border-orange-600 bg-orange-500 text-xl font-bold text-white shadow-md hover:bg-orange-600"
			onclick={() => calculator.operator('-')}
		>
			-
		</button>

		<button
			class="btn btn-lg col-span-2 rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.digit('0')}
		>
			0
		</button>

		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-200 text-xl font-bold text-gray-800 shadow-md hover:bg-gray-300"
			onclick={() => calculator.decimal()}
		>
			.
		</button>
		<button
			class="btn btn-lg rounded-lg border border-gray-400 bg-gray-900 text-xl font-bold text-gray-200 shadow-md hover:bg-gray-700"
			onclick={() => calculator.calculate()}
		>
			=
		</button>
	</div>
</div>
{#if onapply && actions}
	{@render actions(apply)}
{/if}
{#if picking}
	<CalculatorBalancePicker
		{account}
		onselect={(balance) => {
			calculator.insertBalance(balance);
			picking = false;
		}}
		oncancel={() => (picking = false)}
	/>
{/if}
