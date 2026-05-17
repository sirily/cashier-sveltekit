/*
	Provide service layer for the application.
*/
import db from '$lib/data/db';
import { Account, LastXact, Money, Payee, ScheduledTransaction, Xact } from '$lib/data/model';
import { settings, SettingKeys } from '$lib/settings';
import { HomeCardNames, PtaSystems } from '$lib/enums';
import { DefaultCurrencyStore, ScheduledXact, xact } from '$lib/data/mainStore';
import { loadInvestmentAccounts } from './accountsService';
import { get } from 'svelte/store';
import * as LedgerParser from '$lib/utils/ledgerParser';
import * as BeancountParser from '$lib/utils/beancountParser';
import { formatAmount } from '$lib/utils/formatter';
import { readFile, saveFile } from '$lib/utils/opfslib';
import { CASHIER_XACT_FILE, USER_BOOK_FILENAME } from '$lib/constants';
import { ensureInitialized, createParsedLedger } from './rustledger';
import { mapDirectiveSpans } from '$lib/rledger/sourceEditor';

// interface AccountIndex {
// 	[key: string]: Account;
// }

class AppService {
	private mergeAccountBalance(accountBalances: Record<string, Account>, account: Account) {
		const existingAccount = accountBalances[account.name];
		if (!existingAccount) {
			accountBalances[account.name] = account;
			return;
		}

		existingAccount.balances ??= {};
		for (const [currency, amount] of Object.entries(account.balances ?? {})) {
			existingAccount.balances[currency] = amount;
		}

		if (account.balance) {
			existingAccount.balance = account.balance;
		}

		existingAccount.currencies = Array.from(
			new Set([...(existingAccount.currencies ?? []), ...(account.currencies ?? []), ...Object.keys(account.balances ?? {})])
		).sort();
	}

	private parseBalanceSheetAccounts(ptaSystem: string, response: unknown): Account[] {
		const items = this.normalizeBalanceSheetItems(ptaSystem, response);
		if (items.length === 0) {
			throw new Error('No balance records received for import!');
		}

		const accountBalances: Record<string, Account> = {};
		let pendingBalances: Record<string, number> = {};

		for (const item of items) {
			if (item === '') continue;

			let account: Account | null = null;
			if (ptaSystem === PtaSystems.ledger) {
				account = LedgerParser.parseBalanceSheetRow(item as string);
			} else if (ptaSystem === PtaSystems.beancount) {
				account = BeancountParser.parseBalanceSheetRow(item as string[]);
			} else {
				throw new Error('Unknown PTA system: ' + ptaSystem);
			}

			if (!account) {
				continue;
			}

			const balances = account.balances ?? {};
			if (!account.name) {
				pendingBalances = { ...pendingBalances, ...balances };
				continue;
			}

			account.balances = { ...pendingBalances, ...balances };
			pendingBalances = {};

			const [currency, amount] = Object.entries(account.balances ?? {})[0] ?? [];
			if (currency && amount != null) {
				const balance = new Money();
				balance.currency = currency;
				balance.quantity = amount;
				account.balance = balance;
			}

			account.currencies = Array.from(new Set(Object.keys(account.balances ?? {}))).sort();
			this.mergeAccountBalance(accountBalances, account);
		}

		if (Object.keys(pendingBalances).length > 0) {
			throw new Error('Incomplete Ledger balance output: dangling multi-currency continuation row');
		}

		const accounts = Object.values(accountBalances).map((account) => {
			account.currencies = Array.from(new Set(Object.keys(account.balances ?? {}))).sort();
			return account;
		});

		if (accounts.length === 0) {
			throw new Error('No balance records received for import!');
		}

		return accounts;
	}

	async replaceAccounts(ptaSystem: string, response: unknown): Promise<void> {
		const accounts = this.parseBalanceSheetAccounts(ptaSystem, response);
		await db.transaction('rw', db.accounts, async () => {
			await db.accounts.clear();
			await db.accounts.bulkPut(accounts);
		});
	}

	async replacePayees(payeeNames: string[]): Promise<void> {
		const uniquePayees = Array.from(new Set(payeeNames.map((name) => name.trim()).filter(Boolean))).sort();
		if (uniquePayees.length === 0) {
			throw new Error('No payees received');
		}

		const payees = uniquePayees.map((name) => new Payee(name));
		await db.transaction('rw', db.payees, async () => {
			await db.payees.clear();
			await db.payees.bulkPut(payees);
		});
	}

	private normalizeBalanceSheetItems(
		ptaSystem: string,
		response: unknown
	): Array<string | string[]> {
		if (ptaSystem === PtaSystems.beancount) {
			if (Array.isArray(response)) {
				return response as string[][];
			}

			if (
				typeof response === 'object' &&
				response !== null &&
				'rows' in response &&
				Array.isArray((response as { rows?: unknown }).rows)
			) {
				return (response as { rows: string[][] }).rows;
			}
		}

		if (ptaSystem === PtaSystems.ledger && Array.isArray(response)) {
			return response as string[];
		}

		throw new Error(`Unsupported balance sheet response for PTA system: ${ptaSystem}`);
	}
	/**
	 * Clears Ids and reference Ids in Xact and Postings.
	 * @param {Xact} tx
	 */
	clearIds(tx: Xact) {
		delete tx.id;
		// tx.postings.forEach((posting: Posting) => {
		//   delete posting.id
		//   // delete posting.transactionId
		// })
		return tx;
	}

	// createAccount(name: string) {
	// 	const acc = new Account(name);
	// 	return db.accounts.add(acc);
	// }

	createXactFrom(existing: Xact): Xact {
		const newXact = new Xact();
		newXact.date = existing.date;
		newXact.payee = existing.payee;
		newXact.note = existing.note;

		// postings
		if (existing.postings) {
			newXact.postings = [...existing.postings];
		}

		return newXact;
	}

	get db() {
		return db;
	}

	// deleteAccount(name: string) {
	// 	return db.accounts.delete(name);
	// }

	async deleteAccounts() {
		return db.accounts.clear();
	}

	/**
	 * Delete transaction and related postings.
	 * @param {*} id Int/long id of the transaction to delete
	 */
	async deleteTransaction(id: number) {
		if (typeof id === 'string') {
			id = Number(id);
		}

		throw new Error('Delete transaction not implemented yet!');

		// await this.db.xacts.delete(id);

		console.log('Delete transaction completed.', id);
	}

	/**
	 * Delete all transactions.
	 */
	async deleteTransactions() {
		// also clear any remaining postings
		// this.db.postings.clear()
		// await this.db.xacts.clear();
		throw new Error('Delete transactions not implemented yet!');
	}

	async duplicateTransaction(tx: Xact) {
		// copy a new transaction
		const newTx = $state.raw(tx);

		this.clearIds(newTx);

		// return the transaction
		return newTx;
	}

	async getVisibleCards(): Promise<string[]> {
		let visibleCardNames: string[] = (await settings.get(SettingKeys.visibleCards)) as string[];
		if (!visibleCardNames) {
			// create the default cards list here
			visibleCardNames = [
				HomeCardNames.FAVOURITES,
				HomeCardNames.JOURNAL,
				HomeCardNames.SCHEDULED,
				HomeCardNames.FORECAST
			];
		}
		return visibleCardNames;
	}

	/**
	 * Load data from a file.
	 * @param {FileInfo} fileInfo The file info from the input control.
	 * @param {Function} callback A function to run when complete, passing the file content.
	 */
	readFile(fileInfo: Blob, callback: (content: unknown) => void): void {
		if (!fileInfo) return;

		const reader = new FileReader();

		reader.onload = (event) => {
			// File was successfully read.
			const content = event.target?.result;

			callback(content);
		};

		reader.readAsText(fileInfo);
	}

	async readFileAsync(fileInfo: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			if (!fileInfo) reject('FileInfo must be sent!');

			const reader = new FileReader();

			reader.onload = (event) => {
				// File was successfully read.
				const content = event?.target?.result;

				resolve(content as string);
			};
			reader.onerror = (error) => {
				reject(error);
			};

			reader.readAsText(fileInfo);
		});
	}

	/**
	 * Translates Xact into a beancount entry.
	 * @param {Xact} tx
	 * @returns {String} A beancount journal entry
	 */
	translateToBeancount(tx: Xact) {
		let output = '';

		// transaction
		output += tx.date;
		output += ' * "' + tx.payee + '"';
		// note
		if (tx.note) {
			output += ' "' + tx.note + '"';
		}
		output += '\n';

		// postings
		for (let i = 0; i < tx.postings.length; i++) {
			const p = tx.postings[i];
			if (!p.account) continue;

			// indent
			output += '  ';
			output += p.account == null ? '' : p.account;
			if (p.amount) {
				output += '  ';
				output += p.amount == null ? '' : formatAmount(p.amount);
				output += ' ';
				output += p.currency == null ? '' : p.currency;
			}
			output += '\n';
		}

		return output;
	}

	/**
	 * Translates Xact into a ledger entry.
	 * @param {Xact} tx
	 * @returns {String} A ledger entry
	 */
	translateToLedger(tx: Xact) {
		let output = '';

		// transaction
		output += tx.date;
		output += ' ' + tx.payee;
		output += '\n';

		// note
		if (tx.note) {
			output += '    ; ' + tx.note + '\n';
		}

		// postings
		for (let i = 0; i < tx.postings.length; i++) {
			const p = tx.postings[i];
			if (!p.account) continue;

			output += '    ';
			output += p.account == null ? '' : p.account;
			if (p.amount) {
				output += '  ';
				output += p.amount == null ? '' : p.amount;
				output += ' ';
				output += p.currency == null ? '' : p.currency;
			}
			output += '\n';
		}

		return output;
	}

	/**
	 * Format a given value as a number with 2 decimals.
	 * @param {*} value
	 */
	formatNumber(value: number): string | null {
		// if (!value) return;
		if (value == null) return null;
		if (Number.isNaN(value)) return null;

		// make sure we have a number
		const result = Number(value);
		// let val = (value/1).toFixed(2).replace('.', ',')
		// return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")
		return result.toFixed(2);
	}

	async getDefaultCurrency(): Promise<string> {
		let defaultCurrency = get(DefaultCurrencyStore);
		if (!defaultCurrency) {
			defaultCurrency = (await settings.get(SettingKeys.currency)) as string;
			DefaultCurrencyStore.set(defaultCurrency);
		}
		return defaultCurrency;
	}

	/**
	 * Get all the investment commodities. These are commodities used in inv. accounts.
	 */
	async getInvestmentCommodities(): Promise<string[]> {
		// get all investment accounts, iterate to get unique commodities?
		let commodities: string[] = [];

		const accounts = await loadInvestmentAccounts();
		await accounts.forEach((account) => {
			if (!account.balances) return;

			const accountCommodities = Object.keys(account.balances);
			commodities.push(...accountCommodities);
		});

		// keep only unique values
		commodities = [...new Set(commodities)];
		commodities.sort();

		return commodities;
	}

	/**
	 *
	 * @returns All Scheduled Xacts, serialized to JSON.
	 */
	async getScheduledXactsForExport(): Promise<string> {
		const records: ScheduledTransaction[] = await db.scheduled.toArray();
		const output = this.serialize(records);
		return output;
	}

	/**
	 * Imports the accounts list with their balances.
	 * Populates the Account balances. Reads the balances from a Ledger report.
	 * 10,000 AUD  Assets:Bank Account
	 * @param lines Output of `ledger balance --flat`
	 * @returns The promise resolving to the id of the last record updated (Dexie default)
	 */
	async importBalanceSheet(ptaSystem: string, response: unknown): Promise<unknown> {
		if (!response) {
			throw new Error('No balance records received for import!');
		}

		const accounts = this.parseBalanceSheetAccounts(ptaSystem, response);
		return db.accounts.bulkPut(accounts);
	}

	importCommodities(text: string) {
		if (!text) {
			// todo: Notify.create({ message: 'No data to import.' })
			console.error('incomplete');
			return;
		}

		const commodities = [];
		const lines = text.split('\n');

		for (let i = 0; i < lines.length - 1; i++) {
			const commodity = lines[i].trim();
			commodities.push(commodity);
		}

		// todo: save

		return commodities;
	}

	/**
	 * Imports the payees into storage.
	 * @param payees Array of payee names from Ledger.
	 */
	async importPayees(payeeNames: string[]): Promise<void> {
		const uniquePayees = Array.from(new Set(payeeNames.map((name) => name.trim()).filter(Boolean))).sort();
		const payees = uniquePayees.map((name) => new Payee(name));
		await db.payees.bulkPut(payees);
	}

	/**
	 * Imports Scheduled Transactions from a JSON String backup (from the export file).
	 * @param {String} jsonList
	 */
	async importScheduledTransactions(jsonList: string) {
		if (!jsonList) {
			throw new Error('The transactions list is required!');
		}

		const parsed = JSON.parse(jsonList);
		// first delete all existing records?
		await db.scheduled.clear();

		await db.scheduled.bulkPut(parsed);
	}

	// async loadAccount(name: string) {
	// 	return db.accounts.get(name);
	// }

	/**
	 * Loads all transactions for the given account name.
	 * Used to calculate the balance.
	 * @param {String} accountName
	 */
	async loadAccountTransactionsFor(accountName: string): Promise<Xact[]> {
		console.warn('Loading transactions for account:', accountName);

		throw new Error('Load account transactions not implemented yet!');

		// get all the transactions which have postings that have this account.

		// let txs = await db.xacts
		// 	.filter((tx: Xact) => tx.postings.some((posting: Posting) => posting.account == accountName))
		// 	.toArray();

		// txs = XactAugmenter.calculateEmptyPostingAmounts(txs);

		// return txs;
	}

	/**
	 * Loads the favourite accounts.
	 * @returns {Array} List of Account records which are marked as Favourites.
	 */
	// async loadFavouriteAccounts(): Promise<Account[]> {
	// 	const favArray = await settings.get<string[]>(SettingKeys.favouriteAccounts);
	// 	if (!favArray) {
	// 		console.warn('No favourite accounts found.');
	// 		return [];
	// 	}

	// 	// load account details
	// 	const accounts: Account[] = await db.accounts.bulkGet(favArray);

	// 	// Handle any accounts that have not been found.
	// 	// Keep them in the list. They should be grayed out.
	// 	for (let i = 0; i < accounts.length; i++) {
	// 		let account = accounts[i];
	// 		if (account === undefined) {
	// 			// the account has been removed but the Favourites record exists.
	// 			console.warn('Account marked as favourite but not found in Accounts.');

	// 			account = new Account(favArray[i]);
	// 			account.exists = false;
	// 			accounts[i] = account;

	// 			// accounts.splice(i, 1)
	// 			// i--
	// 		}
	// 	}

	// 	return accounts;
	// }

	async loadScheduledXact(id: number): Promise<ScheduledTransaction> {
		const scx = await db.scheduled.get(id);
		if (!scx) {
			throw new Error('Scheduled transaction not found!');
		}
		if (!scx.transaction) {
			throw new Error('Scheduled transaction is missing transaction data!');
		}

		ScheduledXact.set(scx);
		xact.set(scx.transaction);

		return scx;
	}

	// saveAccount(account: Account) {
	// 	return db.accounts.put(account);
	// }

	/**
	 * Saves the given transaction as the Last Xact for the Payee.
	 * This is retrieved when the Payee is selected on a new transaction, or when editing.
	 * @param {Xact} tx
	 */
	async saveLastTransaction(tx: Xact) {
		const lastTx = new LastXact();
		lastTx.payee = tx.payee as string;
		lastTx.transaction = tx;

		// Delete unneeded properties - the ids, date, etc.
		this.clearIds(lastTx.transaction);

		// no need to remember the date
		delete lastTx.transaction.date;

		await this.db.lastXact.put(lastTx);

		return true;
	}

	serialize(content: unknown) {
		return JSON.stringify(content);
	}

	/**
	 * Creates (or overwrites) cashier.bean with empty content.
	 * The include directive for the user's book is injected on-the-fly at
	 * parse time by the ledger worker, so it is never written to disk.
	 */
	async createDefaultCashierFile(): Promise<void> {
		await saveFile(CASHIER_XACT_FILE, '');
	}

	/**
	 * Read the book filename from settings.
	 */
	async readBookFilename(): Promise<string | null> {
		return await settings.get<string>(USER_BOOK_FILENAME);
	}

	/**
	 * Stores the user-selected book filename in settings.
	 */
	async writeBookFilename(filename: string) {
		await settings.set(USER_BOOK_FILENAME, filename);
	}

	/**
	 * Returns the cashier.bean content for export.
	 * The file no longer contains include directives, so no stripping is needed.
	 */
	async stripIncludesFromBookFile(): Promise<string> {
		return (await readFile(CASHIER_XACT_FILE)) ?? '';
	}

	/**
	 * Sort transactions in a Beancount source string by date.
	 * Uses the WASM parser to extract directive spans, then reorders them.
	 */
	async sortTransactionsByDate(source: string): Promise<string> {
		if (!source.trim()) return source;

		await ensureInitialized();
		const ledger = createParsedLedger(source);
		if (!ledger) return source;

		try {
			const spans = mapDirectiveSpans(source, ledger);

			// Each transaction starts with YYYY-MM-DD — extract it directly from the source text.
			const pairs = spans.map((span) => ({
				date: span.sourceText.slice(0, 10),
				sourceText: span.sourceText
			}));

			pairs.sort((a, b) => a.date.localeCompare(b.date));

			return pairs.map((p) => p.sourceText).join('\n\n') + '\n';
		} finally {
			ledger.free();
		}
	}
}

export default new AppService();
