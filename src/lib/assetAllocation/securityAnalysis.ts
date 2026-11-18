import moment from 'moment';
import { settings, SettingKeys } from '../settings';
import appService from '#lib/services/appService';
import { getQueries } from '#lib/sync/sync-queries';
import * as BeancountParser from '#lib/utils/beancountParser';
import { UserError } from '#lib/utils/errors';

const DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Security Analysis for symbols.
 * Calculates yield, etc.
 */

export interface SecurityAnalysis {
	yield: string;
	gainloss: string;
}

export type QueryFn = (bql: string) => Promise<{ columns: string[]; rows: any[]; errors: any[] }>;

function parseSingleAmount(value: unknown) {
	if (typeof value !== 'string') return;
	let text = value.trim();
	if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim();
	// BQL convert() can return an inventory with multiple currencies when prices are missing.
	const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([A-Z/][A-Z0-9'._/-]*)$/.exec(text);
	if (!match) return;
	const quantity = Number(match[1]);
	if (Number.isFinite(quantity)) return { quantity, currency: match[2] };
}

export class SecurityAnalyser {
	currency: string | undefined;
	constructor(private wasmQueryFn: QueryFn) {}

	/** Execute a query against the injected local full-book backend. */
	private async query(command: string): Promise<Array<any>> {
		const result = await this.wasmQueryFn(command);
		if (result.errors.length > 0) {
			throw new Error(`BQL query failed: ${result.errors.map((e: any) => e.message).join('; ')}`);
		}
		return result.rows;
	}

	/**
	 * Calculate the yield in the last 12 months.
	 * This value is affected by the recent purchases, which result in seemingly lower yield!
	 */
	async getYield(symbol: string): Promise<string> {
		const currency = (await settings.get(SettingKeys.currency)) as string;
		this.currency = currency;

		const income = -(await this.#getIncomeBalance(symbol));
		const value = await this.#getValueBalance(symbol, currency);
		if (value === undefined || value === 0 || !Number.isFinite(value) || !Number.isFinite(income)) {
			return 'n/a';
		}

		return `${((income * 100) / value).toFixed(2)}%`;
	}

	async getGainLoss(symbol: string) {
		const currency = await appService.getDefaultCurrency();
		this.currency = currency;

		const queries = getQueries();
		const command = queries.gainLoss(symbol, currency);

		const report: Array<any> = await this.query(command);
		if (report.length == 0) {
			return 'n/a';
		}
		if (report.length > 1) {
			throw new UserError(
				`Multiple gain/loss records found for ${symbol}`,
				'Check your Beancount data for duplicate entries for this symbol',
				'This usually happens when the same symbol exists in multiple accounts without proper cost basis tracking'
			);
		}
		const [cost, value] = report[0];
		const costBasis = parseSingleAmount(cost);
		const marketValue = parseSingleAmount(value);
		if (!costBasis || !marketValue || costBasis.currency !== marketValue.currency) return 'n/a';

		const gainLoss = marketValue.quantity - costBasis.quantity;
		const percent =
			costBasis.quantity === 0 ? 'n/a' : `${((gainLoss / costBasis.quantity) * 100).toFixed(2)}%`;
		return `${gainLoss.toFixed(2)} ${costBasis.currency}, ${percent}`;
	}

	/**
	 * Get the income in the last year.
	 * @returns {Promise<number>} The amount from the symbol's income balance
	 */
	async #getIncomeBalance(symbol: string): Promise<number> {
		const currency = this.currency as string;
		const yieldFrom = moment().subtract(1, 'year').format(DATE_FORMAT);

		const queries = getQueries();
		const command = queries.incomeBalance(symbol, yieldFrom, currency);

		const report = await this.query(command);
		if (report.length == 0) {
			console.warn('No income balance found for symbol ' + symbol);
			return 0;
		}

		const line = report[0];
		return BeancountParser.getMoneyFromTupleString(line[0]).quantity;
	}

	async #getValueBalance(symbol: string, currency: string): Promise<number | undefined> {
		const queries = getQueries();
		const command = queries.valueBalance(symbol, currency);

		const [[balance] = []] = await this.query(command);
		return balance == null ? undefined : BeancountParser.getMoneyFromTupleString(balance).quantity;
	}
}
