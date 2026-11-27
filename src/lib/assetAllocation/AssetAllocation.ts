/*
    Asset Allocation
*/
import { AssetClass, type AssetClassDefinition } from './AssetClass';
import numeral from 'numeral';
import toml from 'toml';
import Big from 'big.js';
import { NUMBER_FORMAT } from '../constants';
import { UserError, ValidationError } from '#lib/utils/errors';
import type { ReportLedger } from '#lib/services/reportPostings';
import {
	allocationPricePolicy,
	queryAllocationHoldings,
	type AllocationCriteria
} from './allocationHoldings';

/**
 * loadDefinition = loads the pre-set definition
 */
export class AssetAllocationEngine {
	assetClasses: AssetClass[] = [];
	// index of name:asset-class pairs
	assetClassIndex: Record<string, AssetClass>;
	stockIndex: Record<string, string>;
	childrenIndex: Map<string, AssetClass[]>;
	warnings: string[] = [];
	valuation: AllocationCriteria | undefined;
	valuationComplete = false;
	hasAllocationPercentages = false;

	constructor() {
		this.assetClassIndex = {};
		this.stockIndex = {};
		this.childrenIndex = new Map();
		this.warnings = [];
	}

	async loadFullAssetAllocation(
		definition: string,
		criteria: AllocationCriteria,
		ledger: ReportLedger
	): Promise<AssetClass[]> {
		// aa definition

		this.assetClasses = await this.parseDefinition(definition);
		if (!this.assetClasses.length) return [];

		this.assetClassIndex = this.buildAssetClassIndex(this.assetClasses);

		// build the children index for efficient lookups
		this.childrenIndex = this.buildChildrenIndex(this.assetClasses);

		// build the stock index
		this.stockIndex = this.buildStockIndex(this.assetClasses);

		await this.loadCurrentValues(criteria, ledger);

		// Sum the balances for groups and calculate offsets only with complete coverage.
		this.sumGroupBalances(this.assetClassIndex);
		if (this.valuationComplete) this.calculateOffsets(this.assetClassIndex);

		// Format numbers for output. Now done in the view.
		// this.formatNumbers(this.assetClassIndex)

		// convert to array for display in a table
		const result: AssetClass[] = Object.values(this.assetClassIndex);

		return result;
	}

	/**
	 * Parse the asset allocation definition without loading current values.
	 * Used for validation during import without the full processing overhead.
	 * This method sets up all internal indices required for validation.
	 * @param definition - The TOML asset allocation definition
	 */
	parseForValidation(definition: string): void {
		this.assetClasses = this.parseDefinition(definition);

		this.assetClassIndex = this.buildAssetClassIndex(this.assetClasses);
		this.childrenIndex = this.buildChildrenIndex(this.assetClasses);
		this.stockIndex = this.buildStockIndex(this.assetClasses);
	}

	buildAssetClassIndex(assetClasses: AssetClass[]): Record<string, AssetClass> {
		const index: Record<string, AssetClass> = {};

		for (let i = 0; i < assetClasses.length; i++) {
			const ac = assetClasses[i];
			index[ac.fullname] = ac;
		}

		return index;
	}

	/**
	 * Build the index of stocks for easy retrieval.
	 * @param {Array} asetClasses
	 */
	buildStockIndex(asetClasses: AssetClass[]): Record<string, string> {
		const index: Record<string, string> = {};

		for (let i = 0; i < asetClasses.length; i++) {
			const assetClass = asetClasses[i];
			if (!assetClass.symbols) continue;

			const stocks = assetClass.symbols;
			for (let j = 0; j < stocks.length; j++) {
				const stock = stocks[j];

				index[stock] = assetClass.fullname;
			}
		}
		return index;
	}

	/**
	 * Builds a children index for efficient child lookups in hierarchical asset allocation data.
	 * @param assetClasses - Array of AssetClass objects
	 * @returns Map where keys are parent names and values are arrays of child AssetClasses
	 */
	private buildChildrenIndex(assetClasses: AssetClass[]): Map<string, AssetClass[]> {
		const childrenIndex = new Map<string, AssetClass[]>();

		for (let i = 0; i < assetClasses.length; i++) {
			const ac = assetClasses[i];
			const parentName = ac.parentName;

			if (!childrenIndex.has(parentName)) {
				childrenIndex.set(parentName, []);
			}

			childrenIndex.get(parentName)?.push(ac);
		}

		return childrenIndex;
	}

	/**
	 * Calculate offsets of the current values from the set allocation values.
	 * @param dictionary Asset Class Index dictionary
	 * @returns
	 */
	calculateOffsets(dictionary: Record<string, AssetClass>) {
		const root = dictionary['Allocation'];
		const total = root.currentValue;
		this.hasAllocationPercentages = !total.eq(0);

		Object.values(dictionary).forEach((ac) => {
			ac.allocatedValue = total.times(ac.allocation).div(100);
			ac.diffAmount = ac.currentValue.minus(ac.allocatedValue).toNumber();
			if (!this.hasAllocationPercentages) return;

			ac.currentAllocation = ac.currentValue.times(100).div(total).toNumber();
			ac.diff = ac.currentAllocation - ac.allocation;
			if (ac.allocation !== 0) ac.diffPerc = (ac.diff * 100) / ac.allocation;
		});
	}

	cleanBlankArrayItems(array: string[]) {
		let i = 0;
		while (i < array.length) {
			const part = array[i];
			if (part === '') {
				array.splice(i, 1);
			} else {
				i++;
			}
		}
		return array;
	}

	/**
	 * Formats the array of Asset Classes (the end result) for txt output.
	 * The output can be stored for historical purposes, compared, etc.
	 * @param {Array} rows
	 */
	formatAllocationRowsForTxtExport(rows: AssetClass[]) {
		const outputRows = [
			`Valuation: ${this.valuation?.currency ?? 'unavailable'} · ${this.valuation?.rootAccount ?? 'no account scope'}`,
			allocationPricePolicy
		];
		if (!this.valuationComplete) {
			outputRows.push(
				'Incomplete valuation: current values, percentages and differences are unavailable.',
				...this.warnings
			);
		} else if (!this.hasAllocationPercentages) {
			outputRows.push(
				'Current percentages and percentage differences are unavailable when the total is zero.'
			);
		}
		outputRows.push(
			'Asset Class       Allocation Current  Diff.  Diff.%  Alloc.Val.  Curr. Val.  Difference'
		);

		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];

			/*
            {"name": "Asset Class", "width": 22},
            {"name": "alloc.", "width": 5},
            {"name": "cur.al.", "width": 6},
            {"name": "diff.", "width": 6},
            {"name": "al.val.", "width": 8},
            {"name": "value", "width": 8},
            {"name": "loc.cur.", "width": 13},
            {"name": "diff", "width": 8}
      */
			let space = '';
			for (let i = row.depth * 2; i > 0; i--) {
				space += ' ';
			}
			// let name = row.name.padStart(22, ' ')
			const firstCol = (space + row.name).padEnd(20, ' ');

			const format = (value: number | Big, width: number, available = true) =>
				(available ? numeral(value).format(NUMBER_FORMAT) : '—').padStart(width, ' ');
			const percentages = this.valuationComplete && this.hasAllocationPercentages;
			const alloc = format(row.allocation, 6);
			const curAl = format(row.currentAllocation, 6, percentages);
			const diff = format(row.diff, 5, percentages);
			const diffPerc = format(row.diffPerc, 6, percentages && row.allocation !== 0);
			const alVal = format(row.allocatedValue, 10, this.valuationComplete);
			const value = format(row.currentValue, 10, this.valuationComplete);
			const diffAmt = format(row.diffAmount, 10, this.valuationComplete);

			const output = `${firstCol}  ${alloc}  ${curAl}  ${diff}  ${diffPerc}  ${alVal}  ${value}  ${diffAmt}`;

			outputRows.push(output);
		}
		const text = outputRows.join('\n');
		return text;
	}

	/**
	 * Imports the account current values into the asset allocation.
	 * Executed during import of Current Values.
	 * Adapted to the Beancount report.
	 * @param {CurrentValuesDict} balancesDict Current values for all accounts
	 */
	// async importCurrentValues(balancesDict: CurrentValuesDict) {
	// 	const accounts = Object.keys(balancesDict);
	// 	for (let i = 0; i < accounts.length; i++) {
	// 		const key = accounts[i];
	// 		const balance: Money = balancesDict[key];

	// 		// Update existing account.
	// 		let account = await appService.db.accounts.get(key);
	// 		if (!account) {
	// 			// create the account
	// 			account = new Account(key);
	// 			account.balance = balance;
	// 		}
	// 		account.currentValue = balance.quantity;
	// 		account.currentCurrency = balance.currency;

	// 		await appService.db.accounts.put(account);
	// 	}
	// }

	/**
	 * Convert a tree AA structure (object) into a list of Asset Classes.
	 * This converts the new structure into the old.
	 * @param {object} rootObject The Asset Allocation object
	 */
	linearizeObject(rootObject: AssetClassDefinition, namespace = ''): AssetClass[] {
		let result: AssetClass[] = [];

		// only use the children.

		for (const propertyName in rootObject) {
			const child = rootObject[propertyName] as AssetClassDefinition;

			// Only process the other definitions, not the properties (like allocation).
			// symbols is an array, which is also an object. Skip.
			if (!(typeof child == 'object') || child.constructor === Array) continue;

			// convert to Asset Class
			const item = new AssetClass();
			item.allocation = child.allocation;
			item.symbols = child.symbols;
			// get the name
			if (namespace) {
				item.fullname = namespace + ':' + propertyName;
			} else {
				item.fullname = propertyName;
			}

			result.push(item);

			// iterate
			let childNamespace = namespace;
			if (namespace) {
				childNamespace += ':';
			}
			childNamespace += propertyName;

			const children = this.linearizeObject(child, childNamespace);
			if (children.length) {
				result = result.concat(children);
			}
		}

		return result;
	}

	parseDefinition(definition: string): AssetClass[] {
		if (!definition) {
			throw new ValidationError(
				'Asset allocation definition is empty',
				'definition',
				'Please import or create an asset allocation definition file'
			);
		}

		// read from TOML file.
		const parsed = toml.parse(definition);
		const assetClasses = this.linearizeObject(parsed);

		return assetClasses;
	}

	/** Read and map every nonzero account/commodity holding. */
	async loadCurrentValues(criteria: AllocationCriteria, ledger: ReportLedger) {
		this.valuation = criteria;
		const { holdings, warnings } = await queryAllocationHoldings(ledger, criteria);
		const values = new Map<AssetClass, Big>();
		for (const { account, commodity, quantity, value } of holdings) {
			const name = Object.hasOwn(this.stockIndex, commodity) ? this.stockIndex[commodity] : '';
			const assetClass = this.assetClassIndex[name];
			if (!assetClass || (name !== 'Allocation' && !name.startsWith('Allocation:'))) {
				warnings.push(
					`${account}: ${quantity} ${commodity} is not mapped to an asset class under Allocation. Add the commodity to the allocation definition.`
				);
			} else if (value) {
				values.set(assetClass, (values.get(assetClass) ?? Big(0)).plus(value));
			}
		}
		this.warnings = [...new Set(warnings)];
		this.valuationComplete = this.warnings.length === 0;
		if (this.valuationComplete) {
			for (const [assetClass, value] of values) assetClass.currentValue = value;
			for (const assetClass of this.assetClasses) assetClass.currency = criteria.currency;
		}
	}

	sumGroupBalances(acIndex: Record<string, AssetClass>) {
		const root = acIndex['Allocation'];

		if (root == null) {
			throw new UserError(
				'Asset Allocation root not found',
				'Please import a valid asset allocation definition file with an "Allocation" root entry',
				'The allocation file should contain a top-level "Allocation" section'
			);
		}

		const sum = this.sumChildren(acIndex, root);

		root.currentValue = sum;
	}

	sumChildren(dictionary: object, item: AssetClass): Big {
		// find all children using the pre-built index (O(1) lookup)
		const children = this.childrenIndex.get(item.fullname) || [];
		if (children.length === 0) {
			return item.currentValue;
		}

		let sum = item.currentValue;
		for (let i = 0; i < children.length; i++) {
			const child: AssetClass = children[i];
			child.currentValue = this.sumChildren(dictionary, child);

			const amount = child.currentValue;
			sum = sum.plus(amount);
		}

		return sum;
	}
}
