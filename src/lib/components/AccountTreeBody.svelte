<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { resolve } from '$app/paths';
	import MultiCurrencyBalance from '#lib/components/MultiCurrencyBalance.svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import appService from '#lib/services/appService';
	import { ReportRequest } from '#lib/services/reportRequest.svelte';
	import { reportDiagnostic } from '#lib/services/reportPostings';

	interface TreeNode {
		name: string;
		label: string;
		level: number;
		children: string[];
		balances: Record<string, number>;
	}

	const expanded = new SvelteMap<string, boolean>();
	const version = fullLedgerService.version;
	const reloading = fullLedgerService.isReloading;
	const request = new ReportRequest<{
		map: Map<string, TreeNode>;
		roots: string[];
		defaultCurrency: string;
		version: number;
	}>();
	const pending = $derived(
		$reloading || request.pending || (request.value !== null && request.value.version !== $version)
	);

	$effect(() => {
		const currentVersion = $version;
		if ($reloading) return;
		void request.run(
			() => loadData(currentVersion),
			() => !$reloading && $version === currentVersion
		);
		return () => request.cancel();
	});

	async function loadData(currentVersion: number) {
		await fullLedgerService.ensureLoaded();
		if (!fullLedgerService.isLoaded) throw new Error('No local book loaded.');
		const [defaultCurrency, allAccounts, result] = await Promise.all([
			appService.getDefaultCurrency(),
			fullLedgerService.getAllAccounts(),
			fullLedgerService.query('SELECT account, sum(position) AS balance')
		]);
		if (result.errors.length) throw new Error(result.errors.map(reportDiagnostic).join('; '));
		const accountIdx = result.columns.indexOf('account');
		const balanceIdx = result.columns.indexOf('balance');
		if (accountIdx < 0 || balanceIdx < 0)
			throw new Error('Unexpected account balance query result.');

		const balanceMap = new SvelteMap<string, Record<string, number>>();
		for (const row of result.rows) {
			if (!Array.isArray(row) || typeof row[accountIdx] !== 'string') {
				throw new Error('Unexpected account balance row.');
			}
			balanceMap.set(row[accountIdx], extractBalances(row[balanceIdx]));
		}

		const map = new Map<string, TreeNode>();
		for (const acc of allAccounts) {
			ensureNode(acc.name, map);
		}

		// Assign own balances
		for (const [name, balances] of balanceMap) {
			const node = map.get(name);
			if (node) {
				for (const [cur, amt] of Object.entries(balances)) {
					node.balances[cur] = (node.balances[cur] ?? 0) + amt;
				}
			}
		}

		// Aggregate balances bottom-up (deepest nodes first)
		const sorted = [...map.keys()].sort((a, b) => b.split(':').length - a.split(':').length);
		for (const name of sorted) {
			const parts = name.split(':');
			if (parts.length < 2) continue;
			const parentName = parts.slice(0, -1).join(':');
			const parent = map.get(parentName);
			const node = map.get(name)!;
			if (parent) {
				for (const [cur, amt] of Object.entries(node.balances)) {
					parent.balances[cur] = (parent.balances[cur] ?? 0) + amt;
				}
			}
		}

		return {
			map,
			roots: [...map.keys()].filter((name) => !name.includes(':')).sort(),
			defaultCurrency,
			version: currentVersion
		};
	}

	function ensureNode(fullName: string, map: Map<string, TreeNode>) {
		if (map.has(fullName)) return;
		const parts = fullName.split(':');
		map.set(fullName, {
			name: fullName,
			label: parts[parts.length - 1],
			level: parts.length - 1,
			children: [],
			balances: {}
		});
		if (parts.length > 1) {
			const parentName = parts.slice(0, -1).join(':');
			ensureNode(parentName, map);
			const parent = map.get(parentName)!;
			if (!parent.children.includes(fullName)) {
				parent.children.push(fullName);
			}
		}
	}

	function extractBalances(cell: any): Record<string, number> {
		const out: Record<string, number> = {};
		if (!cell || typeof cell !== 'object') return out;
		if (Array.isArray(cell.positions)) {
			for (const pos of cell.positions) {
				if (pos?.units?.currency && pos.units.number != null)
					out[pos.units.currency] = (out[pos.units.currency] ?? 0) + parseFloat(pos.units.number);
			}
			return out;
		}
		if (cell.units?.currency && cell.units.number != null) {
			out[cell.units.currency] = parseFloat(cell.units.number);
			return out;
		}
		if (cell.currency && cell.number != null) out[cell.currency] = parseFloat(cell.number);
		return out;
	}

	function isExpanded(node: TreeNode) {
		return expanded.get(node.name) ?? node.level === 0;
	}

	function getAccountTypeColour(name: string): string {
		const root = name.split(':')[0];
		if (root === 'Income') return 'text-primary-200';
		if (root === 'Expenses') return 'text-secondary-200';
		if (root === 'Liabilities') return 'text-purple-200';
		return '';
	}

	let visibleNodes: TreeNode[] = $derived.by(() => {
		const result: TreeNode[] = [];
		function walk(names: string[]) {
			for (const name of [...names].sort()) {
				const node = request.value?.map.get(name);
				if (!node) continue;
				result.push(node);
				if (isExpanded(node)) walk(node.children);
			}
		}
		walk(request.value?.roots ?? []);
		return result;
	});
</script>

{#if pending}
	<p role="status" class="p-2">Loading account tree…</p>
{:else if request.error}
	<p role="alert" class="p-2">Account tree unavailable: {request.error}</p>
{:else if visibleNodes.length === 0}
	<p class="p-2">No accounts in the local book.</p>
{:else}
	<div class="min-w-max">
		{#each visibleNodes as node (node.name)}
			<div class="border-base-content/15 border-b {getAccountTypeColour(node.name)}">
				<div
					class="flex w-full items-start py-1.5"
					style:padding-left={`${node.level * 1.25 + 0.25}rem`}
				>
					{#if node.children.length > 0}
						<button
							type="button"
							class="hover:bg-base-300 mr-1 flex size-5 shrink-0 items-center justify-center rounded"
							onclick={() => expanded.set(node.name, !isExpanded(node))}
							aria-label={isExpanded(node) ? 'Collapse' : 'Expand'}
							aria-expanded={isExpanded(node)}
						>
							{#if isExpanded(node)}
								<ChevronDown class="size-4 opacity-60" />
							{:else}
								<ChevronRight class="size-4 opacity-60" />
							{/if}
						</button>
					{:else}
						<span class="mr-1 size-5 shrink-0" aria-hidden="true"></span>
					{/if}
					<a
						class="flex-1 whitespace-nowrap hover:underline {node.level === 0
							? 'font-semibold'
							: ''}"
						href={resolve('/accounts/account-xacts/[accountName]', {
							accountName: encodeURIComponent(node.name)
						})}
					>
						{node.label}
					</a>
					<MultiCurrencyBalance
						balances={node.balances}
						defaultCurrency={request.value?.defaultCurrency ?? ''}
						loaded={true}
						class="shrink-0 pr-2 text-sm"
					/>
				</div>
			</div>
		{/each}
	</div>
{/if}
