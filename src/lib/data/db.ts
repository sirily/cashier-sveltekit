/*
    Data access layer, using Dexie.
*/
import Dexie, { type Table } from 'dexie';
import {
	Account,
	LastXact,
	// Xact,
	Payee,
	// Posting,
	ScheduledTransaction,
	Setting
} from '$lib/data/model';

// Define the schema

interface CashierDatabase extends Dexie {
	accounts: Table<Account, string>;
	lastXact: Table<LastXact, string>;
	payees: Table<Payee, string>;
	scheduled: Table<ScheduledTransaction, number>;
	settings: Table<Setting, string>;
	// xacts: Table;
}

const db = new Dexie('Cashier') as CashierDatabase;

// Schema

db.version(1).stores({
	lastXact: 'payee',
	scheduled: '++id, nextDate',
	settings: 'key'
	// xacts: '++id, date'
});

db.version(2).stores({
	accounts: 'name',
	lastXact: 'payee',
	payees: 'name',
	scheduled: '++id, nextDate',
	settings: 'key'
	// xacts: '++id, date'
});

// Mappings

db.accounts.mapToClass(Account);
db.lastXact.mapToClass(LastXact);
db.payees.mapToClass(Payee);
// db.xacts.mapToClass(Xact);
db.settings.mapToClass(Setting);
db.scheduled.mapToClass(ScheduledTransaction);

export default db;
