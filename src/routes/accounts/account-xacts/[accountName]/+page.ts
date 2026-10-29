/*
    Account Transactions
*/

import { Account, type Xact } from '#lib/data/model.js';
import ledgerService from '#lib/services/ledgerService.js';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import type { DirectiveSpan } from '#lib/rledger/sourceEditor';
import { ensureInitialized } from '#lib/data/initializer';
import { get } from 'svelte/store';
import type { PageLoad } from './$types';

export type UnifiedXact = {
	date: string;
	payee: string;
	narration: string;
	amount: number;
	currency: string;
	isDevice: boolean;
	xact?: Xact;
	span?: DirectiveSpan;
};

export const load = (({ params, depends }) => {
	if (!params.accountName) {
		throw new Error('Account must be specified!');
	}

	depends('ledger:account-history');
	return {
		accountName: params.accountName,
		history: loadHistory(params.accountName).then(
			(data) => ({ data, error: null }),
			(error: unknown) => ({
				data: null,
				error: error instanceof Error ? error.message : String(error)
			})
		)
	};
}) satisfies PageLoad;

async function loadHistory(accountName: string) {
	// Route loads can run before the root layout's onMount initialization.
	await ensureInitialized();
	await fullLedgerService.ensureLoaded();
	const version = get(fullLedgerService.version);
	const account =
		(await fullLedgerService.getAccountWithBalances(accountName)) ?? new Account(accountName);

	// On-device transactions
	await ledgerService.load();
	const xactsWithSpans = await ledgerService.getXactsWithSpans();
	const deviceXacts = xactsWithSpans.filter(({ xact }) =>
		xact.postings?.some((p) => p.account === accountName)
	);

	// Full ledger transactions for this account
	const bql = `SELECT date, payee, narration, number, currency \
WHERE account = '${accountName}'`;
	const { columns, rows, errors } = await fullLedgerService.query(bql);
	if (errors?.length) {
		throw new Error(errors.map((error: any) => error.message ?? String(error)).join('; '));
	}

	// Normalize device xacts
	const deviceRows: UnifiedXact[] = deviceXacts.map(({ xact, span }) => {
		const posting = xact.postings?.find((p) => p.account === accountName);
		return {
			date: xact.date ?? '',
			payee: xact.payee ?? '',
			narration: xact.note ?? '',
			amount: posting?.amount ?? 0,
			currency: posting?.currency ?? '',
			isDevice: true,
			xact,
			span
		};
	});

	// Normalize ledger rows
	const safeColumns: string[] = columns ?? [];
	const safeRows = (rows ?? []) as unknown[][];
	const dateIdx = safeColumns.indexOf('date');
	const payeeIdx = safeColumns.indexOf('payee');
	const narrationIdx = safeColumns.indexOf('narration');
	const numberIdx = safeColumns.indexOf('number');
	const currencyIdx = safeColumns.indexOf('currency');

	const ledgerNormalized: UnifiedXact[] = safeRows.map((row) => ({
		date: row[dateIdx] as string,
		payee: row[payeeIdx] as string,
		narration: row[narrationIdx] as string,
		amount: parseFloat(row[numberIdx] as string),
		currency: row[currencyIdx] as string,
		isDevice: false
	}));

	// Mark ledger rows that match a device row, then add only unmatched device rows
	const unmatchedDeviceRows: UnifiedXact[] = [];
	for (const dr of deviceRows) {
		const matchIdx = ledgerNormalized.findIndex(
			(lr) =>
				lr.date === dr.date &&
				lr.payee === dr.payee &&
				lr.amount === dr.amount &&
				lr.currency === dr.currency
		);
		if (matchIdx !== -1) {
			ledgerNormalized[matchIdx].isDevice = true;
			ledgerNormalized[matchIdx].xact = dr.xact;
			ledgerNormalized[matchIdx].span = dr.span;
		} else {
			unmatchedDeviceRows.push(dr);
		}
	}

	// Merge and sort descending by date
	const unifiedRows = [...unmatchedDeviceRows, ...ledgerNormalized].sort((a, b) =>
		b.date.localeCompare(a.date)
	);

	const hasDeviceXacts = deviceRows.length > 0;

	if (!fullLedgerService.isLoaded || version !== get(fullLedgerService.version)) {
		return loadHistory(accountName);
	}
	return { account, unifiedRows, hasDeviceXacts, version };
}
