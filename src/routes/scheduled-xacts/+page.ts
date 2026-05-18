/*
    Scheduled Transactions list
*/
import db from '$lib/data/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async () => {
	const data = await loadData();
	return data;
};

async function loadData() {
	const sorted = await db.scheduled
		.orderBy('nextDate')
		//.sortBy('symbol')
		.toArray();

	// sort also by payee, case insensitive
	sorted.sort((a, b) => {
		const payee1 = a.transaction?.payee ?? '';
		const payee2 = b.transaction?.payee ?? '';

		const sorting = a.nextDate.localeCompare(b.nextDate);
		return sorting == 0 ? payee1.localeCompare(payee2, 'en', { sensitivity: 'base' }) : sorting;
	});

	return { sorted };
}
