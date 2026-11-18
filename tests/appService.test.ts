/*
    appService tests
*/

import { Posting, Xact } from '#lib/data/model';
import appService from '#lib/services/appService';
import { assert, test } from 'vitest';

test('duplicating xact', () => {
	const existing = new Xact();
	existing.id = 123;
	existing.date = '2024-12-13';
	existing.payee = 'Supermarket';
	existing.note = 'some food';
	existing.flag = '!';

	const p1 = new Posting();
	p1.account = 'Expenses:Food';
	p1.amount = 20;
	p1.currency = 'EUR';
	p1.price = { kind: 'total', amount: '22', currency: 'USD' };
	const p2 = new Posting();
	p2.account = 'Assets:Cash';
	//p2.amount
	existing.postings = [p1, p2];

	const actual = appService.createXactFrom(existing);

	assert.isUndefined(actual.id);
	assert.equal(actual.date, existing.date);
	assert.equal(actual.payee, existing.payee);
	assert.equal(actual.note, existing.note);
	assert.equal(actual.flag, '!');
	assert.deepEqual(actual.postings, existing.postings);
	assert.notStrictEqual(actual.postings[0], p1);
	assert.notStrictEqual(actual.postings[0].price, p1.price);
});
