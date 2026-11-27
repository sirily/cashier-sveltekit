import { USER_BOOK_FILENAME } from '#lib/constants';
import { SettingKeys, settings } from '#lib/settings';

export const DEFAULT_DATE_FORMAT = 'D MMM YYYY';

/** Persisted settings only. Hosts decide whether to edit or initialize values. */
export async function readSettingsPreferences() {
	const [
		currency,
		bookFilename,
		rootInvestmentAccount,
		rememberLastTransaction,
		ledgerCacheEnabled,
		assetAllocationDefinition,
		dateFormat
	] = await Promise.all([
		settings.get<string>(SettingKeys.currency),
		settings.get<string>(USER_BOOK_FILENAME),
		settings.get<string>(SettingKeys.rootInvestmentAccount),
		settings.get<boolean>(SettingKeys.rememberLastTransaction),
		settings.get<boolean>(SettingKeys.ledgerCacheEnabled),
		settings.get<string>(SettingKeys.assetAllocationDefinition),
		settings.get<string>(SettingKeys.dateFormat)
	]);
	return {
		currency: currency ?? undefined,
		bookFilename,
		rootInvestmentAccount: rootInvestmentAccount ?? undefined,
		rememberLastTransaction: rememberLastTransaction ?? undefined,
		ledgerCacheEnabled: ledgerCacheEnabled ?? true,
		assetAllocationDefinition,
		dateFormat: dateFormat ?? DEFAULT_DATE_FORMAT
	};
}
