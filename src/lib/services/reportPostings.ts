export interface ReportQueryResult {
	columns: string[];
	rows: unknown[];
	errors: unknown[];
}

export interface ReportLedger {
	query(bql: string): Promise<ReportQueryResult>;
	getErrors(): Promise<unknown[]>;
}

export interface ReportCriteria {
	scope: 'expenses' | 'income-expense';
	dateFrom: string;
	dateTo: string;
	currency: string;
}

export interface ReportPosting {
	date: string;
	account: string;
	amount: number;
}

export interface ReportIssue {
	date: string;
	account: string;
	description: string;
	message: string;
}

export interface ReportPostings {
	postings: ReportPosting[];
	issues: ReportIssue[];
	diagnostics: string[];
	complete: boolean;
}

export function reportDiagnostic(error: unknown): string {
	if (error && typeof error === 'object' && 'message' in error) {
		const location = 'line' in error && error.line != null ? ` (line ${error.line})` : '';
		return `${String(error.message)}${location}`;
	}
	return typeof error === 'string' ? error : JSON.stringify(error);
}

function resultRows(result: ReportQueryResult, required: string[]): Record<string, unknown>[] {
	if (result.errors.length) throw new Error(result.errors.map(reportDiagnostic).join('; '));
	if (required.some((name) => !result.columns.includes(name))) {
		throw new Error('Unexpected report query result columns.');
	}
	return result.rows.map((row) => {
		if (!Array.isArray(row)) throw new Error('Unexpected report query row.');
		return Object.fromEntries(result.columns.map((name, index) => [name, row[index]]));
	});
}

function amount(value: unknown): { number: number; currency: string } | null {
	if (!value || typeof value !== 'object' || !('number' in value) || !('currency' in value)) {
		return null;
	}
	const raw = value.number;
	const number =
		typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '') ? Number(raw) : NaN;
	return Number.isFinite(number) && typeof value.currency === 'string' && value.currency !== ''
		? { number, currency: value.currency }
		: null;
}

/** Validate raw positions before UNITS/CONVERT: WASM 0.14.1 errors on null positions.
 * Keep CONVERT's structured amount: missing prices return the original commodity, not null.
 * Both queries must be discarded by the caller if the worker composition changes between them.
 */
export async function queryReportPostings(
	ledger: ReportLedger,
	criteria: ReportCriteria
): Promise<ReportPostings> {
	const { scope, dateFrom, dateTo, currency } = criteria;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
		throw new Error('Invalid report period.');
	}
	if (!/^[A-Za-z][A-Za-z0-9._'-]*$/.test(currency)) {
		throw new Error('Select a valid report currency in Settings.');
	}
	const accountFilter =
		scope === 'expenses'
			? 'account ~ "^Expenses"'
			: '(account ~ "^Income" OR account ~ "^Expenses")';
	const where = `${accountFilter} AND date >= ${dateFrom} AND date <= ${dateTo}`;
	const fields = ['date', 'account', 'position', 'payee', 'narration'];
	const raw = resultRows(await ledger.query(`SELECT ${fields.join(', ')} WHERE ${where}`), fields);
	const diagnostics = (await ledger.getErrors()).map(reportDiagnostic);
	const issues: ReportIssue[] = [];
	for (const row of raw) {
		const position = row.position;
		const units =
			position && typeof position === 'object' && 'units' in position
				? amount(position.units)
				: null;
		if (!units) {
			issues.push({
				date: String(row.date),
				account: String(row.account),
				description: [row.payee, row.narration].filter(Boolean).join(' — '),
				message:
					'Unresolved posting amount (position is missing or invalid). Correct the source transaction.'
			});
		}
	}
	if (issues.length) return { postings: [], issues, diagnostics, complete: false };

	const convertedFields = [...fields, 'converted'];
	const converted = resultRows(
		await ledger.query(
			`SELECT ${fields.join(', ')}, CONVERT(units(position), "${currency}") AS converted WHERE ${where}`
		),
		convertedFields
	);
	if (converted.length !== raw.length)
		throw new Error('Report sources changed during valuation. Retry the report.');
	const postings: ReportPosting[] = [];
	for (const row of converted) {
		const valued = amount(row.converted);
		if (!valued || valued.currency !== currency) {
			const position = row.position;
			const units =
				position && typeof position === 'object' && 'units' in position
					? amount(position.units)
					: null;
			issues.push({
				date: String(row.date),
				account: String(row.account),
				description: [row.payee, row.narration].filter(Boolean).join(' — '),
				message: `No usable conversion to ${currency}; original amount: ${units ? `${units.number} ${units.currency}` : 'unavailable'}.`
			});
		} else {
			postings.push({
				date: String(row.date),
				account: String(row.account),
				amount: valued.number
			});
		}
	}
	const complete = issues.length === 0 && diagnostics.length === 0;
	return { postings: complete ? postings : [], issues, diagnostics, complete };
}
