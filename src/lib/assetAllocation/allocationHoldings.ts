import Big from 'big.js';
import { UserError } from '#lib/utils/errors';
import { reportDiagnostic, type ReportLedger } from '#lib/services/reportPostings';

export type AllocationCriteria = Readonly<{ rootAccount: string; currency: string }>;

export const allocationPricePolicy =
	'RustLedger values net holding units using the latest available prices in the local analysis book, including indirect rates and transaction-implied prices. All book dates are included, even future dates; there is no age cutoff.';

export interface AllocationHolding {
	account: string;
	commodity: string;
	quantity: Big;
	value: Big | null;
}

function decimal(value: unknown): Big | null {
	// RustLedger serializes its Decimal values as strings; never parse through JS numbers.
	return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) ? Big(value) : null;
}

async function rows(ledger: ReportLedger, bql: string, columns: string[]): Promise<unknown[][]> {
	const result = await ledger.query(bql);
	if (result.errors.length) {
		throw new UserError(
			`Allocation query failed: ${result.errors.map(reportDiagnostic).join('; ')}`,
			'Check the local book in Validation and reload Asset Allocation.'
		);
	}
	if (
		result.columns.length !== columns.length ||
		columns.some((column, i) => result.columns[i] !== column)
	) {
		throw new Error('Unexpected allocation query columns.');
	}
	return result.rows.map((row) => {
		if (!Array.isArray(row) || row.length !== columns.length) {
			throw new Error('Unexpected allocation query row.');
		}
		return row;
	});
}

export function allocationAccountFilter(rootAccount: string): string {
	if (!/^[\p{Lu}][\p{L}\p{N}-]*(?::[\p{Lu}\p{N}][\p{L}\p{N}-]*)*$/u.test(rootAccount)) {
		throw new UserError('Missing or invalid investment account root.', 'Set it in Settings.');
	}
	// RustLedger's BQL regex comparison is case-insensitive unless opted out.
	return `account ~ "(?-i:^${rootAccount}(:|$))"`;
}

export async function queryAllocationHoldings(ledger: ReportLedger, criteria: AllocationCriteria) {
	const { rootAccount, currency } = criteria;
	const scope = allocationAccountFilter(rootAccount);
	// Accept RustLedger commodity tokens, including slash-prefixed futures, without
	// accepting characters that can escape the double-quoted BQL string below.
	if (!/^(?:[A-Za-z][A-Za-z0-9._'-]*|\/[A-Z0-9._'-]*[A-Z][A-Z0-9._'-]*)$/.test(currency)) {
		throw new UserError('Missing or invalid valuation currency.', 'Select a currency in Settings.');
	}
	const [accounts, unresolved, balances, diagnostics] = await Promise.all([
		rows(ledger, `SELECT account FROM #accounts WHERE ${scope} LIMIT 1`, ['account']),
		rows(ledger, `SELECT date, account, narration WHERE ${scope} AND position IS NULL`, [
			'date',
			'account',
			'narration'
		]),
		// Aggregate signed units across all lots. GETPRICE needs an explicit upper date:
		// without it, a grouped query can use the first posting's price instead of the
		// latest book price. The upper bound includes future-dated book entries as well.
		rows(
			ledger,
			`SELECT account, currency, SUM(number) AS quantity, GETPRICE(currency, "${currency}", 9999-12-31) AS rate
			WHERE ${scope} AND position IS NOT NULL GROUP BY account, currency ORDER BY account, currency`,
			['account', 'currency', 'quantity', 'rate']
		),
		ledger.getErrors()
	]);
	const warnings = diagnostics.map(
		(diagnostic) => `Local book diagnostic: ${reportDiagnostic(diagnostic)}. Check Validation.`
	);
	if (!accounts.length && !balances.length && !unresolved.length) {
		warnings.push(
			`No account matches ${rootAccount}. Check the investment account root in Settings.`
		);
	}
	for (const [date, account, narration] of unresolved) {
		warnings.push(
			`${date} · ${account}${narration ? ` · ${narration}` : ''}: Unresolved posting amount. Correct the source transaction.`
		);
	}
	const holdings: AllocationHolding[] = [];
	for (const [account, commodity, quantity, rawRate] of balances) {
		const units = decimal(quantity);
		if (!units || typeof account !== 'string' || typeof commodity !== 'string' || !commodity) {
			throw new Error('Invalid original holding returned by the local analysis book.');
		}
		if (units.eq(0)) continue;
		const rate = commodity === currency ? Big(1) : decimal(rawRate);
		const value = rate ? units.times(rate) : null;
		if (!value) {
			warnings.push(
				`${account}: No usable price for ${units} ${commodity} in ${currency}. Add a price or conversion rate to the local book.`
			);
		}
		holdings.push({ account, commodity, quantity: units, value });
	}
	return { holdings, warnings };
}
