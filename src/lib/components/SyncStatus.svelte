<script lang="ts">
	import type { Snippet } from 'svelte';
	import { syncAction } from '#lib/sync/sync-action.svelte';
	import { syncFeedback } from '#lib/sync/sync-feedback.svelte';
	import { syncProgress } from '#lib/stores/syncProgressStore';

	let { action }: { action?: Snippet } = $props();
	const diagnostics = $derived(syncFeedback.diagnostics);
	const syncStarted = $derived(diagnostics !== null);
	const waiting = $derived(syncAction.running);
</script>

{#snippet statusIcon(status: string | undefined)}
	{#if status === 'in-progress'}
		<span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
		<span class="sr-only">In progress</span>
	{:else if status === 'completed'}
		<span class="text-success" aria-hidden="true">✓</span>
		<span class="sr-only">Completed</span>
	{:else if status === 'error'}
		<span class="text-error" aria-hidden="true">✗</span>
		<span class="sr-only">Failed</span>
	{:else}
		<span class="inline-block w-4"></span>
	{/if}
{/snippet}

<p>
	Synchronize sends completed local entries, downloads and validates the server book, then removes
	only confirmed local copies and refreshes the displayed book.
</p>

<table class="table table-zebra w-full table-raised border border-base-300 rounded-xl">
	<thead>
		<tr>
			<th>Send → pull → reconcile</th>
			{#if syncStarted}<th class="w-0.5">Status</th>{/if}
		</tr>
	</thead>
	<tbody>
		<tr>
			<td>Send completed local transactions</td>
			{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 0)?.status)}</td
				>{/if}
		</tr>
		<tr>
			<td>Download server book</td>
			{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 6)?.status)}</td
				>{/if}
		</tr>
		<tr>
			<td>Select downloaded root book</td>
			{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 7)?.status)}</td
				>{/if}
		</tr>
		<tr>
			<td>Validate downloaded server book</td>
			{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 8)?.status)}</td
				>{/if}
		</tr>
		<tr>
			<td>Reconcile local journal</td>
			{#if syncStarted}<td>{@render statusIcon($syncProgress.find((s) => s.id === 9)?.status)}</td
				>{/if}
		</tr>
		{#if diagnostics}
			<tr>
				<td>Refresh displayed book</td>
				<td>{diagnostics.refreshResult ?? '-'}</td>
			</tr>
		{/if}
	</tbody>
</table>

{#if action}
	{@render action()}
{/if}
{#if waiting}
	<p role="status">Synchronization in progress…</p>
{:else if !diagnostics && !action}
	<p>No synchronization results yet.</p>
{/if}

{#if diagnostics?.syncErrors?.length}
	<div class="alert alert-error items-start shadow-sm" role="alert">
		<div>
			<h2 class="font-semibold">Synchronization has errors</h2>
			<ul class="mt-2 list-disc space-y-1 pl-5">
				{#each diagnostics.syncErrors as error, i (`${error.stage}:${error.message}:${i}`)}
					<li>
						<span class="font-medium">{error.stage}:</span>
						{#if error.cashierId}<code>{error.cashierId}</code> —
						{/if}
						{error.message}
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
				<div>Ledger files</div>
				<div>{diagnostics.ledgerFilesCount ?? '-'}</div>
				<div>Selected root book</div>
				<div>{diagnostics.selectedRootBookFilename ?? '-'}</div>
				<div>Root book size</div>
				<div>{diagnostics.rootBookSize ?? '-'}</div>
				<div>Parse result</div>
				<div>{diagnostics.parseResult ?? '-'}</div>
				<div>Parse errors</div>
				<div>{diagnostics.parseErrorCount ?? '-'}</div>
				<div>Display refresh</div>
				<div>{diagnostics.refreshResult ?? '-'}</div>
				{#if diagnostics.lastError}
					<div>Last error</div>
					<div class="break-words">{diagnostics.lastError}</div>
				{/if}
				{#if diagnostics.parseErrors?.length}
					<div>Parse error details</div>
					<div class="space-y-1 break-words">
						{#each diagnostics.parseErrors as error, i (`${error}:${i}`)}
							<div>{error}</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
