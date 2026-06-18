import { describe, expect, test } from 'vitest';
import { Posting, Xact } from '$lib/data/model';
import { applyAutoIncompleteFlag, xactToBeancountText } from '$lib/utils/xactUtils';

function posting(account: string, amount?: number, currency = 'USD') {
	const p = new Posting();
	p.account = account;
	p.amount = amount;
	p.currency = currency;
	return p;
}

describe('applyAutoIncompleteFlag', () => {
	test('returns auto-incomplete transaction to complete after placeholders are filled', () => {
		const tx = Xact.create();
		let autoIncomplete = false;

		autoIncomplete = applyAutoIncompleteFlag(tx, true, autoIncomplete);
		expect(tx.flag).toBe('!');
		expect(autoIncomplete).toBe(true);

		tx.postings = [posting('Expenses:EatingOut:Coffee', 10), posting('Assets:Physical:Cash', -10)];

		autoIncomplete = applyAutoIncompleteFlag(tx, false, autoIncomplete);

		expect(tx.flag).toBe('*');
		expect(autoIncomplete).toBe(false);
		expect(xactToBeancountText(tx)).toMatch(/^\d{4}-\d{2}-\d{2} \*/);
	});

	test('keeps manually selected incomplete flag after placeholders are filled', () => {
		const tx = Xact.create();
		tx.flag = '!';
		let autoIncomplete = false;

		autoIncomplete = applyAutoIncompleteFlag(tx, true, autoIncomplete);
		expect(tx.flag).toBe('!');
		expect(autoIncomplete).toBe(false);

		tx.postings = [posting('Expenses:EatingOut:Coffee', 10), posting('Assets:Physical:Cash', -10)];

		autoIncomplete = applyAutoIncompleteFlag(tx, false, autoIncomplete);

		expect(tx.flag).toBe('!');
		expect(autoIncomplete).toBe(false);
		expect(xactToBeancountText(tx)).toMatch(/^\d{4}-\d{2}-\d{2} !/);
	});
});
