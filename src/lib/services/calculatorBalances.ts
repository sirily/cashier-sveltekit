import Big from 'big.js';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { reportDiagnostic, type ReportLedger } from '#lib/services/reportPostings';

export type CalculatorBalance = { amount: string; currency: string };

async function queryRows(ledger: ReportLedger, bql: string, fields: string[]) {
	const { columns, rows, errors } = await ledger.query(bql);
	if (errors.length) throw new Error(errors.map(reportDiagnostic).join('; '));
	const indices = fields.map((field) => columns.indexOf(field));
	if (indices.includes(-1)) throw new Error('Unexpected balance query columns.');
	return rows.map((row) => {
		if (!Array.isArray(row)) throw new Error('Unexpected balance query row.');
		return indices.map((i) => row[i] as unknown);
	});
}

/** Includes closed accounts, which remain available as sources in the calculator. */
export async function readCalculatorAccounts() {
	const [rows, diagnostics] = await Promise.all([
		queryRows(fullLedgerService, 'SELECT account FROM #accounts ORDER BY account', ['account']),
		fullLedgerService.getErrors()
	]);
	if (diagnostics.length) {
		throw new Error(`Local book diagnostics: ${diagnostics.map(reportDiagnostic).join('; ')}`);
	}
	return [
		...new Set(
			rows.map(([name]) => {
				if (typeof name !== 'string' || !name) throw new Error('Invalid local account name.');
				return name;
			})
		)
	];
}

/** Read original units for the exact account, without valuation or zero fallback. */
export async function readCalculatorBalances(
	account: string,
	ledger: ReportLedger = fullLedgerService
): Promise<CalculatorBalance[]> {
	const scope = `account = ${JSON.stringify(account)}`;
	const [balances, unresolved, diagnostics] = await Promise.all([
		queryRows(
			ledger,
			`SELECT currency, SUM(number) AS amount WHERE ${scope} AND position IS NOT NULL GROUP BY currency ORDER BY currency`,
			['currency', 'amount']
		),
		queryRows(ledger, `SELECT account WHERE ${scope} AND position IS NULL LIMIT 1`, ['account']),
		ledger.getErrors()
	]);
	if (unresolved.length)
		throw new Error('This account has unresolved posting amounts. Check Validation.');
	if (diagnostics.length)
		throw new Error('The local book has ledger diagnostics. Check Validation.');
	return balances.map(([currency, amount]) => {
		if (
			typeof currency !== 'string' ||
			!currency ||
			(typeof amount !== 'string' && typeof amount !== 'number') ||
			!Number.isFinite(Number(amount)) ||
			String(amount).trim() === ''
		) {
			throw new Error('The local book returned an invalid balance.');
		}
		return { currency, amount: new Big(amount).toFixed() };
	});
}
