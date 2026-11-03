/*
    Various configuration-related things
*/
import db from '#lib/data/db';
import { Setting } from '#lib/data/model';
import { retiredRemoteSettingKeys } from '#lib/retiredRemoteSettings';

/**
 * Contains all the values required for the selection mode to function.
 * When an object of this type exists in the state store, we are in selection mode.
 */
export class SelectionModeMetadata {
	// The selection requestor. Can be used to explicitly name the origin and
	// avoid confusion in unexpected navigation routes.
	origin = '';

	postingIndex?: number;

	// The type of item being selected. Useful on return to the original entity.
	selectionType?: string;

	// The id of the selected item.
	selectedId: unknown;

	// Initial value to populate the calculator with
	initialValue?: number;
}

export const Constants = {
	CacheName: 'cashier',
	ForecastDays: 7
};

export interface AccountGroup {
	title: string;
	accounts: string[];
	color?: string;
}

export const defaultAccountGroups: AccountGroup[] = [
	{ title: 'Cash Accounts', accounts: [] },
	{ title: 'Bank Accounts', accounts: [] },
	{ title: 'Savings Accounts', accounts: [] },
	{ title: 'Credit Cards', accounts: [] },
	{ title: 'Loans', accounts: [] }
];

export const SettingKeys = {
	// asset allocation settings
	assetAllocationDefinition: 'aa.definition',
	rootInvestmentAccount: 'aa.rootAccount',
	//

	currency: 'currency',
	rememberLastTransaction: 'rememberLastTransaction',
	favouriteAccounts: 'favouriteAccounts',
	// forecast
	forecastAccounts: 'forecast.accounts',
	forecastDays: 'forecast.days',
	//

	// Cashier Server Sync
	syncServerUrl: 'syncServerUrl',
	syncApiToken: 'syncApiToken',
	syncBeancountRootFile: 'syncBeancountRootFile',
	// Server source; legacy values are normalized when read.
	ledgerDataSource: 'ledgerDataSource',
	// synchronization choices
	syncAccounts: 'syncAccounts',
	syncAaValues: 'syncAaValues',
	syncAssetAllocation: 'syncAssetAllocation',
	syncPayees: 'syncPayees',
	syncLedgerFiles: 'syncLedgerFiles',
	syncOpeningBalances: 'syncOpeningBalances',
	// Home cards
	visibleCards: 'homeCardNames',
	// Peer sync
	peerId: 'peerId',
	// Server selection
	syncServers: 'syncServers',
	syncActiveServerId: 'syncActiveServerId',
	syncServerSelectionCleared: 'syncServerSelectionCleared',

	storageBackend: 'storageBackend',
	bookFilename: 'userBookFilename',
	// SHA-256 hash of source files at last serialization, stored alongside the OPFS binary cache
	ledgerCacheHash: 'ledgerCacheHash',
	// Whether to use the binary ledger cache on load (default: true)
	ledgerCacheEnabled: 'ledgerCacheEnabled',
	// Account groups for the groups page
	accountGroups: 'accountGroups',

	// Date display format (moment.js format string)
	dateFormat: 'dateFormat'
};

export const CardNames = {
	FavouritesCard: 'FavouritesCard',
	ForecastCard: 'ForecastCard',
	JournalCard: 'JournalCard',
	ScheduledXactCard: 'ScheduledXactCard',
	SyncCard: 'SyncCard'
};

class Settings {
	private retiredSettingsCleanup?: Promise<void>;

	private removeRetiredSettings(): Promise<void> {
		// Best-effort local cleanup shared by concurrent reads; failures retry on the next load.
		return (this.retiredSettingsCleanup ??= db.settings
			.bulkDelete([...retiredRemoteSettingKeys])
			.catch(() => {
				this.retiredSettingsCleanup = undefined;
			}));
	}

	/**
	 *
	 * @param {any} key
	 * @returns Promise with the Setting object
	 */
	async get<T>(key: string): Promise<T | null> {
		await this.removeRetiredSettings();
		if (retiredRemoteSettingKeys.some((retiredKey) => retiredKey === key)) return null;
		const setting = await db.settings.get(key);

		if (!setting) return (key === SettingKeys.ledgerDataSource ? 'beancount' : null) as T | null;

		let value = null;
		try {
			value = JSON.parse(setting.value);
		} catch {
			value = setting.value;
		}

		// Normalize only recognized retired sources. Reads do not rewrite configuration or sync.
		if (key === SettingKeys.ledgerDataSource && (value === 'filesystem' || value === 'ledger')) {
			return 'beancount' as T;
		}
		return value;
	}

	async getAll() {
		await this.removeRetiredSettings();
		const entries = await db.settings.toArray();
		return entries.filter(
			({ key }) => !retiredRemoteSettingKeys.some((retiredKey) => retiredKey === key)
		);
	}

	async set(key: string, value: unknown) {
		const jsonValue = JSON.stringify(value);
		const setting = new Setting(key, jsonValue);

		await db.settings.put(setting);
	}
}

const settings = new Settings();
export { settings };
