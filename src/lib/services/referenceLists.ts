import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { reportDiagnostic } from '#lib/services/reportPostings';

export async function readAccountReferences() {
	await fullLedgerService.ensureLoaded();
	if (!fullLedgerService.isLoaded) throw new Error('No local book loaded.');
	const accounts = await fullLedgerService.getAllAccounts();
	return accounts.toSorted((a, b) => a.name.localeCompare(b.name));
}

export async function readPayeeReferences() {
	const result = await fullLedgerService.query(
		'SELECT DISTINCT COALESCE(payee, narration) as payee FROM transactions ORDER BY payee'
	);
	if (result.errors.length) throw new Error(result.errors.map(reportDiagnostic).join('; '));
	const column = result.columns.indexOf('payee');
	if (column < 0) throw new Error('Unexpected payee query result.');
	const names = new Set<string>();
	for (const row of result.rows) {
		if (!Array.isArray(row)) throw new Error('Unexpected payee row.');
		const name: unknown = row[column];
		if (typeof name === 'string' && name) names.add(name);
	}
	return [...names].sort((a, b) => a.localeCompare(b));
}
