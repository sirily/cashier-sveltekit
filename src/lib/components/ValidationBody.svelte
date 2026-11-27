<script lang="ts">
	import { resolve } from '$app/paths';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';

	type ErrorItem = { severity: string; line: number; column: number; message: string };
	let {
		onreload,
		reloading = false,
		reloadError = ''
	}: {
		onreload?: () => void;
		reloading?: boolean;
		reloadError?: string;
	} = $props();
	const version = fullLedgerService.version;
	const workerReloading = fullLedgerService.isReloading;
	const request = new ReportRequest<{ issues: ErrorItem[]; version: number }>();
	const pending = $derived(
		$workerReloading ||
			reloading ||
			request.pending ||
			(request.value !== null && request.value.version !== $version)
	);
	const loadError = $derived(reloadError || request.error);
	const status = $derived(
		reloadError ? 'error' : pending ? 'loading' : loadError ? 'error' : 'done'
	);
	const errors = $derived(
		request.value?.issues.filter((issue) => issue.severity === 'error') ?? []
	);
	const warnings = $derived(
		request.value?.issues.filter((issue) => issue.severity === 'warning') ?? []
	);
	const isValid = $derived(errors.length === 0);
	const totalIssues = $derived(errors.length + warnings.length);

	$effect(() => {
		const currentVersion = $version;
		if ($workerReloading || reloading || reloadError) return;
		void request.run(
			async () => ({
				issues: (await fullLedgerService.getErrors()) as ErrorItem[],
				version: currentVersion
			}),
			() => !$workerReloading && !reloading && !reloadError && $version === currentVersion
		);
		return () => request.cancel();
	});
</script>

<section class="mx-auto max-w-4xl space-y-4 p-4">
	<!-- Controls -->
	<div class="flex flex-wrap items-center gap-3">
		{#if onreload}
			<button type="button" class="btn btn-primary" onclick={onreload} disabled={reloading}>
				{reloading ? 'Validating…' : 'Reload & Validate'}
			</button>
		{/if}
		<a class="btn btn-outline" href={resolve('/ledger/multi')}>Inspect parsed ledger</a>

		{#if status === 'done'}
			<div class="badge {isValid ? 'badge-success' : 'badge-error'} gap-1 text-sm">
				{isValid ? 'Valid' : 'Invalid'}
			</div>
			{#if totalIssues > 0}
				<span class="text-sm text-base-content/60">
					{errors.length} error{errors.length !== 1 ? 's' : ''},
					{warnings.length} warning{warnings.length !== 1 ? 's' : ''}
				</span>
			{/if}
		{/if}
	</div>

	<!-- Load error -->
	{#if status === 'error' && loadError}
		<div class="alert alert-error" role="alert">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				class="h-6 w-6 shrink-0 stroke-current"
				fill="none"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
				/>
			</svg>
			<div>
				<p class="font-semibold">Failed to load ledger</p>
				<p class="text-sm">{loadError}</p>
			</div>
		</div>
	{/if}

	<!-- Loading skeleton -->
	{#if status === 'loading'}
		<div class="card bg-base-100 shadow" role="status" aria-label="Validating ledger">
			<div class="card-body gap-3">
				<div class="skeleton h-4 w-48"></div>
				<div class="skeleton h-4 w-full"></div>
				<div class="skeleton h-4 w-3/4"></div>
			</div>
		</div>
	{/if}

	<!-- Results -->
	{#if status === 'done'}
		{#if totalIssues === 0}
			<div class="alert alert-success">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-6 w-6 shrink-0 stroke-current"
					fill="none"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<span><strong>All clear!</strong> No errors or warnings found in the ledger.</span>
			</div>
		{:else}
			<!-- Errors -->
			{#if errors.length > 0}
				<section class="card bg-base-100 shadow">
					<div class="card-body p-4">
						<h2 class="card-title text-error">
							Errors
							<span class="badge badge-error badge-sm">{errors.length}</span>
						</h2>
						<div class="overflow-x-auto">
							<table class="table table-zebra table-sm">
								<thead>
									<tr>
										<th class="w-20">Line</th>
										<th class="w-20">Column</th>
										<th>Message</th>
									</tr>
								</thead>
								<tbody>
									{#each errors as err, i (`${err.line}:${err.column}:${err.message}:${i}`)}
										<tr class="text-error">
											<td class="font-mono">{err.line}</td>
											<td class="font-mono">{err.column}</td>
											<td>{err.message}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</section>
			{/if}

			<!-- Warnings -->
			{#if warnings.length > 0}
				<section class="card bg-base-100 shadow">
					<div class="card-body p-4">
						<h2 class="card-title text-warning">
							Warnings
							<span class="badge badge-warning badge-sm">{warnings.length}</span>
						</h2>
						<div class="overflow-x-auto">
							<table class="table table-zebra table-sm">
								<thead>
									<tr>
										<th class="w-20">Line</th>
										<th class="w-20">Column</th>
										<th>Message</th>
									</tr>
								</thead>
								<tbody>
									{#each warnings as warn, i (`${warn.line}:${warn.column}:${warn.message}:${i}`)}
										<tr class="text-warning">
											<td class="font-mono">{warn.line}</td>
											<td class="font-mono">{warn.column}</td>
											<td>{warn.message}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</section>
			{/if}
		{/if}
	{/if}
</section>
