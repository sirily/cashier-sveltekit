/**
 * Common Data Access Layer (DAL) code.
 */

import type { Account, Payee } from './model';

export interface DAL {
	loadAccounts(): Promise<Account[]>;
	loadPayees(): Promise<Payee[]>;
}
