<script lang="ts">
	import type { ReportPostings } from '#lib/services/reportPostings';

	let { result, currency }: { result: ReportPostings; currency: string } = $props();
</script>

<p class="mb-3 text-sm text-base-content/60">
	Valuation: {currency}, using CONVERT on posting units and the latest available prices in this
	analysis book (not transaction-date prices; no maximum price age). Income is shown as the negative
	of signed Beancount Income postings; refunds reduce expenses.
</p>
{#if !result.complete}
	<div role="status" class="rounded-lg border border-base-300 p-3 text-sm">
		<p class="font-medium">Report incomplete — totals and charts are hidden.</p>
		<p>
			Some posting amounts or valuations are unresolved, or the ledger has diagnostics. Correct the
			source data and reload the ledger before using this report's totals.
		</p>
		<details class="mt-2">
			<summary class="cursor-pointer"
				>Report diagnostics ({result.issues.length + result.diagnostics.length})</summary
			>
			<ul class="mt-2 space-y-2 break-words">
				{#each result.issues as issue, index (index)}
					<li>
						{issue.date} · {issue.account} · {issue.description}: {issue.message}
					</li>
				{/each}
				{#each result.diagnostics as diagnostic, index (index)}
					<li class="font-mono">{diagnostic}</li>
				{/each}
			</ul>
		</details>
	</div>
{/if}
