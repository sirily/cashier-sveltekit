/**
 * Contains queries for the sync, PTA system.
 */

export interface Queries {
	incomeBalance(symbol: string, yieldFrom: string, currency: string): string;
	gainLoss(symbol: string, currency: string, accountFilter?: string): string;
	valueBalance(symbol: string, currency: string, accountFilter?: string): string;
}

const BeancountQueries: Queries = {
	/**
	 * Income balance for symbol
	 * @returns Income from the security.
	 */
	incomeBalance: (symbol: string, yieldFrom: string, currency: string) =>
		`SELECT str(CONVERT(value(sum(position)), '${currency}')) as balance, account \
        WHERE account ~ '^Income.*:${symbol}$' \
            AND date >= ${yieldFrom}`,
	gainLoss: (symbol: string, currency: string, accountFilter?: string) =>
		// No subtraction on Inventories.
		// value(sum(position)) - cost(sum(position)) AS unrealized_gain \
		// account, \
		// str(sum(position)) AS units, \
		`SELECT 
            str(convert(cost(sum(position)), '${currency}')) AS cost_basis, \
            str(convert(value(sum(position)), '${currency}')) AS market_value \
        WHERE currency = ${JSON.stringify(symbol)}${accountFilter ? ` AND ${accountFilter}` : ''}`,
	valueBalance: (symbol: string, currency: string, accountFilter?: string) => {
		// convert the symbol to the account-name-compatible form.
		// symbol = symbol.replace('.', '-')
		return `select str(convert(sum(position), '${currency}')) \
                where currency = ${JSON.stringify(symbol)}${accountFilter ? ` AND ${accountFilter}` : ''}`;
	}
};

export function getQueries(): Queries {
	return BeancountQueries;
}
