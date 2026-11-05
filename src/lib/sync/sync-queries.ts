/**
 * Contains queries for the sync, PTA system.
 */

export interface Queries {
	accounts(): string;
	openAccounts(): string;
	balances(): string;
	currentValues(rootAccount: string, currency: string): string;
	lots(symbol: string): string;
	payees(from?: string): string;
	incomeBalance(symbol: string, yieldFrom: string, currency: string): string;
	gainLoss(symbol: string, currency: string): string;
	valueBalance(symbol: string, currency: string): string;
}

const BeancountQueries: Queries = {
	/**
	 * # is url-encoded (%23)
	 * @returns accounts query
	 */
	accounts: () => 'SELECT sum(number), currency, account ORDER BY account',
	openAccounts: () => 'SELECT account from #accounts where close is null',
	balances: () => 'SELECT account, sum(number), currency ORDER BY account',
	currentValues: (rootAccount: string, currency: string) =>
		`SELECT account, str(CONVERT(value(sum(position)), '${currency}'))
        WHERE account ~ '^${rootAccount}'
        GROUP BY account
        HAVING NOT empty(sum(position))
        ORDER BY account`,
	lots: (_symbol: string) => 'balances',
	payees: (from: string) =>
		`SELECT DISTINCT COALESCE(payee, narration) as payee FROM transactions \
         WHERE date >= ${from} ORDER BY payee`,
	/**
	 * Income balance for symbol
	 * @returns Income from the security.
	 */
	incomeBalance: (symbol: string, yieldFrom: string, currency: string) =>
		`SELECT str(CONVERT(value(sum(position)), '${currency}')) as balance, account \
        WHERE account ~ '^Income.*:${symbol}$' \
            AND date >= ${yieldFrom}`,
	gainLoss: (symbol: string, currency: string) =>
		// No subtraction on Inventories.
		// value(sum(position)) - cost(sum(position)) AS unrealized_gain \
		// account, \
		// str(sum(position)) AS units, \
		`SELECT 
            str(convert(cost(sum(position)), '${currency}')) AS cost_basis, \
            str(convert(value(sum(position)), '${currency}')) AS market_value \
        WHERE currency = '${symbol}'`,
	valueBalance: (symbol: string, currency: string) => {
		// convert the symbol to the account-name-compatible form.
		// symbol = symbol.replace('.', '-')
		return `select str(convert(sum(position), '${currency}')) \
                where currency = '${symbol}'`;
	}
};

export function getQueries(): Queries {
	return BeancountQueries;
}
