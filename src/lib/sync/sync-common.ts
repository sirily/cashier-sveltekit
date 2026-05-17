/**
 * Common synchronization logic shared by all sync sources.
 * Handles parsing, storage, and orchestration after raw data is fetched.
 */
import appService from '$lib/services/appService';
import CashierDAL from '$lib/data/dbdal';

export interface SyncSteps {
	syncAccounts?: boolean;
	syncAaValues?: boolean;
	syncAssetAllocation?: boolean;
	syncPayees?: boolean;
	syncOpeningBalances?: boolean;
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

	await appService.deleteAccounts();
	await appService.importBalanceSheet(ptaSystem, response);
}

/**
 * Stage 1 sync is read-only for accounts and payees.
 * Current values are intentionally skipped until asset allocation sync is wired back in.
 */
export async function syncCurrentValues(_ptaSystem: string, _result: any): Promise<void> {
	return;
}

/**
 * Delete existing payees and import new ones.
 */
export async function syncPayees(payeeNames: string[]): Promise<void> {
	if (!payeeNames || payeeNames.length === 0) {
		throw new Error('No payees received');
	}

	const dal = new CashierDAL();
	await dal.deletePayees();
	await appService.importPayees(payeeNames);
}
