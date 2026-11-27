<script lang="ts" generics="Row">
	import type { Snippet } from 'svelte';
	import SearchToolbar from './SearchToolbar.svelte';
	import { ListSearch } from '#lib/utils/ListSearch';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';

	let {
		label,
		focus = false,
		read,
		name,
		row,
		controls
	}: {
		label: string;
		focus?: boolean;
		read: () => Promise<Row[]>;
		name: (row: Row) => string;
		row: Snippet<[Row]>;
		controls?: Snippet<[string]>;
	} = $props();

	let search = $state('');
	const listSearch = new ListSearch();
	const version = fullLedgerService.version;
	const reloading = fullLedgerService.isReloading;
	const request = new ReportRequest<Row[]>();
	const result = $derived.by(() => {
		const rows = request.value ?? [];
		if (!search) return { rows, invalid: false };
		try {
			const regex = listSearch.getRegex(search);
			return { rows: rows.filter((item) => regex.test(name(item))), invalid: false };
		} catch {
			return { rows: [], invalid: true };
		}
	});

	$effect(() => {
		const current = $version;
		const load = read;
		if ($reloading) return;
		void request.run(load, () => $version === current && !$reloading);
		return () => request.cancel();
	});
</script>

<div class="sticky top-0 z-1">
	<SearchToolbar
		{focus}
		label={`Search ${label.toLowerCase()}`}
		onSearch={(value) => (search = value)}
	/>
</div>
{#if controls}
	{@render controls(search)}
{/if}
{#if request.pending || $reloading}
	<p role="status" class="p-2">Loading {label.toLowerCase()}…</p>
{:else if request.error}
	<p role="alert" class="p-2">{label} unavailable: {request.error}</p>
{:else if result.invalid}
	<p class="p-2">Invalid search expression.</p>
{:else if result.rows.length === 0}
	<p class="p-2">
		{search ? 'No matching results.' : `No ${label.toLowerCase()} in the local book.`}
	</p>
{:else}
	<ul aria-label={label} class="px-1">
		{#each result.rows as item (name(item))}
			<li role="listitem">{@render row(item)}</li>
		{/each}
	</ul>
{/if}
