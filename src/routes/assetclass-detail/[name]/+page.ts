import { resolve } from '$app/paths';
import { error, redirect } from '@sveltejs/kit';
import type { AssetClass, StockSymbol } from '#lib/assetAllocation/AssetClass';
import {
	allocationAccountFilter,
	type AllocationHolding
} from '#lib/assetAllocation/allocationHoldings';
import { loadAssetAllocation } from '#lib/assetAllocation/loadAssetAllocation';
import { AaStocksStore } from '#lib/data/mainStore';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import type { PageLoad } from './$types';
import { get } from 'svelte/store';

export type WasmQueryFn = (
	bql: string
) => Promise<{ columns: string[]; rows: any[]; errors: any[] }>;

export interface RawQueryResult {
	query: string;
	columns: string[];
	rows: any[];
	errors: any[];
}

/*
    Asset Class Detail
 */
export const load: PageLoad = async ({ params }) => {
	const aa = await loadAssetAllocation().catch(() => redirect(307, resolve('/asset-allocation')));
	const assetClass = aa.assetClasses.find((item) => item.fullname === params.name);
	if (!assetClass) {
		error(404, 'Asset class not found');
	}

	if (!aa.valuation) error(500, 'Asset allocation valuation scope is unavailable.');
	const { currency, rootAccount } = aa.valuation;
	const ledgerVersion = get(fullLedgerService.version);
	const isCurrent = () =>
		!get(fullLedgerService.isReloading) && get(fullLedgerService.version) === ledgerVersion;
	const wasmQuery: WasmQueryFn = async (bql) => {
		if (!isCurrent()) throw new Error('The local book changed. Reopen Asset Class Detail.');
		const result = await fullLedgerService.query(bql);
		if (!isCurrent()) throw new Error('The local book changed. Reopen Asset Class Detail.');
		return result;
	};
	return {
		wasmQuery,
		ledgerVersion,
		accountFilter: allocationAccountFilter(rootAccount),
		investmentHoldings: aa.holdings,
		currency,
		assetClass,
		stocks: populateStocksWithCaching(assetClass, aa.holdings),
		valuation: {
			complete: aa.valuationComplete,
			percentages: aa.valuationComplete && aa.hasAllocationPercentages,
			warnings: aa.warnings
		}
	};
};

function populateStocksWithCaching(
	assetClass: AssetClass,
	holdings: AllocationHolding[]
): StockSymbol[] {
	const cache = get(AaStocksStore);
	return assetClass.symbols.map((name) => ({
		name,
		holdings: holdings.filter((holding) => holding.commodity === name),
		// Cache security analysis only, not account rows from a previous calculation.
		analysis: cache?.[name]?.analysis
	}));
}
