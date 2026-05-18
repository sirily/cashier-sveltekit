/**
 * Common synchronization logic shared by all sync sources.
 * Handles parsing, storage, and orchestration after raw data is fetched.
 */
import appService from '$lib/services/appService';

export interface SyncSteps {
	syncAccounts?: boolean;
	syncAaValues?: boolean;
	syncAssetAllocation?: boolean;
	syncPayees?: boolean;
	syncOpeningBalances?: boolean;
	syncLedgerFiles?: boolean;
}

/**
 * Delete existing accounts and import new ones from a balance sheet response.
 */
export async function syncAccounts(
	ptaSystem: string,
	response: Record<string, unknown>
): Promise<void> {
	if (!response || Object.keys(response).length === 0) {
		throw new Error('No accounts received');
	}

	await appService.replaceAccounts(ptaSystem, response);
}

/**
 * Stage 1 sync does not support current values / asset allocation imports.
 */
export async function syncCurrentValues(_ptaSystem: string, _result: any): Promise<void> {
	throw new Error('Stage 1 sync does not support current values or asset allocation import');
}

/**
 * Delete existing payees and import new ones.
 */
export async function syncPayees(payeeNames: string[]): Promise<void> {
	if (!payeeNames || payeeNames.length === 0) {
		throw new Error('No payees received');
	}

	await appService.replacePayees(payeeNames);
}
