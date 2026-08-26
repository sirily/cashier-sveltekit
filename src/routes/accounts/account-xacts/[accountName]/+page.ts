/*
    Account Transactions
*/

import { Account, Money, type Xact } from '$lib/data/model.js';
import ledgerService from '$lib/services/ledgerService.js';
import fullLedgerService from '$lib/services/ledgerWorkerClient';
import type { DirectiveSpan } from '$lib/rledger/sourceEditor';

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

export async function load({ params }) {
	if (!params.accountName) {
		throw new Error('Account must be specified!');
	}

	const account =
		(await fullLedgerService.getAccountWithBalances(params.accountName)) ??
		new Account(params.accountName);

	// take the first balance
	const total: Money = new Money();
	const balanceKeys = account.balances ? Object.keys(account.balances) : [];
	total.quantity = balanceKeys.length ? account.balances![balanceKeys[0]] : 0;
	total.currency = balanceKeys[0] ?? '';

	// On-device transactions
	await ledgerService.load();
	const xactsWithSpans = await ledgerService.getXactsWithSpans();
	const deviceXacts = xactsWithSpans.filter(({ xact }) =>
		xact.postings?.some((p) => p.account === params.accountName)
	);

	// Normalize device xacts
	const deviceRows: UnifiedXact[] = deviceXacts.map(({ xact, span }) => {
		const posting = xact.postings?.find((p) => p.account === params.accountName);
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

	// Build one row per server transaction directive. A BQL account query returns
	// one row per matching posting, so mapping those rows directly duplicates a
	// transaction that has multiple postings to the selected account.
	const directives = (await fullLedgerService.getDirectives()) as Array<{
		type?: string;
		date?: string;
		payee?: string;
		narration?: string;
		postings?: Array<{
			account?: string;
			units?: { number?: string | number; currency?: string };
		}>;
	}>;
	const ledgerNormalized: UnifiedXact[] = directives.flatMap((directive) => {
		if (directive.type !== 'transaction') return [];
		const matchingPostings = (directive.postings ?? []).filter(
			(posting) => posting.account === params.accountName
		);
		if (matchingPostings.length === 0) return [];

		const currencies = new Set(matchingPostings.map((posting) => posting.units?.currency ?? ''));
		const sameCurrency = currencies.size === 1;
		return [
			{
				date: directive.date ?? '',
				payee: directive.payee ?? '',
				narration: directive.narration ?? '',
				amount: sameCurrency
					? matchingPostings.reduce(
							(sum, posting) => sum + Number(posting.units?.number ?? 0),
							0
						)
					: Number(matchingPostings[0].units?.number ?? 0),
				currency: matchingPostings[0].units?.currency ?? '',
				isDevice: false
			}
		];
	});

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

	return { account, total, unifiedRows, hasDeviceXacts };
}
