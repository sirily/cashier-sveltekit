<script lang="ts">
	import { tick } from 'svelte';
	import type { Xact } from '#lib/data/model';
	import type { DirectiveSpan } from '#lib/rledger/sourceEditor';
	import ledgerService from '#lib/services/ledgerService';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';
	import { syncAction } from '#lib/sync/sync-action.svelte';
	import JournalXactRow from './JournalXactRow.svelte';

	let {
		recent = true,
		onselect
	}: { recent?: boolean; onselect?: (xact: Xact, span: DirectiveSpan) => void } = $props();

	const version = ledgerService.version;
	const request = new ReportRequest<Array<{ xact: Xact; span: DirectiveSpan }>>();
	let list = $state<HTMLElement>();

	const entries = $derived(
		recent
			? (request.value ?? [])
					.toSorted(
						(a, b) =>
							(b.xact.date ?? '').localeCompare(a.xact.date ?? '') ||
							b.span.startLine - a.span.startLine
					)
					.slice(0, 5)
			: (request.value ?? [])
	);

	$effect(() => {
		const currentVersion = $version;
		const finishedSyncs = syncAction.completedRuns;
		void request.run(
			() => ledgerService.getXactsWithSpans(),
			() => $version === currentVersion && syncAction.completedRuns === finishedSyncs
		);
		return () => request.cancel();
	});

	$effect(() => {
		if (recent || !request.value || !list) return;
		const element = list;
		void tick().then(() => {
			element.scrollTop = element.scrollHeight;
		});
	});

	// The route calls this only after the durable Delete All write succeeds.
	export function clear() {
		request.cancel();
		request.value = [];
		request.pending = false;
	}
</script>

<section class={recent ? 'space-y-1' : 'grow space-y-2 p-1 pb-3'} bind:this={list}>
	{#if request.pending}
		<p role="status">Loading the device journal…</p>
	{:else if request.error}
		<p role="alert">Could not read the device journal: {request.error}</p>
	{:else if entries.length === 0}
		<p>The device journal is empty</p>
	{:else}
		{#each entries as { xact, span } (span.startLine)}
			<JournalXactRow
				{xact}
				compact={recent}
				isLocal={!recent}
				onclick={onselect && (() => onselect?.(xact, span))}
			/>
		{/each}
	{/if}
</section>
