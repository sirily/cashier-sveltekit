import { get } from 'svelte/store';
import {
	AaStocksStore,
	AssetAllocationLoadedAtStore,
	AssetAllocationStore
} from '#lib/data/mainStore';
import { SettingKeys, settings } from '#lib/settings';
import { AppError, UserError } from '#lib/utils/errors';
import { readFile } from '#lib/utils/opfslib';
import fullLedgerService from '#lib/services/ledgerWorkerClient';
import { AssetAllocationEngine } from './AssetAllocation';

let generation = 0;

export function resetAssetAllocation() {
	generation++;
	clearAllocationCache();
}

function clearAllocationCache() {
	AssetAllocationStore.set(undefined);
	AaStocksStore.set(undefined);
	AssetAllocationLoadedAtStore.set(undefined);
}

async function readDefinition() {
	const path = await settings.get<string>(SettingKeys.assetAllocationDefinition);
	if (!path) {
		throw new UserError(
			'No asset allocation definition file is selected.',
			'Select a TOML file in Settings.'
		);
	}

	const definition = await readFile(path).catch((error: unknown) => {
		const reason = error instanceof Error ? error.message : String(error);
		throw new UserError(`Could not read asset allocation definition "${path}": ${reason}`);
	});
	if (definition === undefined) {
		throw new UserError(
			`Could not open asset allocation definition "${path}".`,
			'Check File Storage and the file selection in Settings.'
		);
	}

	return { path, definition };
}

export async function loadAssetAllocation() {
	// Assign the generation before any reads so even a slow definition read cannot
	// clear or replace a result from a more recent request.
	const request = ++generation;
	try {
		const [{ path, definition }, root, target] = await Promise.all([
			readDefinition(),
			settings.get(SettingKeys.rootInvestmentAccount),
			settings.get(SettingKeys.currency)
		]);
		const criteria = {
			rootAccount: typeof root === 'string' ? root : '',
			currency: typeof target === 'string' ? target : ''
		};
		await fullLedgerService.ensureLoaded();
		if (!fullLedgerService.isLoaded) throw new UserError('No local book loaded.');
		const ledgerVersion = get(fullLedgerService.version);
		const cached = get(AssetAllocationStore);
		if (
			cached?.path === path &&
			cached.definition === definition &&
			cached.ledgerVersion === ledgerVersion &&
			cached.rootAccount === criteria.rootAccount &&
			cached.currency === criteria.currency
		) {
			return cached.engine;
		}

		if (request === generation) clearAllocationCache();
		const engine = new AssetAllocationEngine();
		try {
			await engine.loadFullAssetAllocation(definition, criteria, fullLedgerService);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new UserError(
				`Could not load asset allocation definition "${path}": ${reason}`,
				error instanceof AppError ? error.action : undefined
			);
		}
		if (!engine.assetClasses.length) {
			throw new UserError(
				`Asset allocation definition "${path}" has no classes.`,
				'Add a top-level [Allocation] section.'
			);
		}
		if (ledgerVersion !== get(fullLedgerService.version) || !fullLedgerService.isLoaded) {
			throw new UserError('The local book changed during valuation. Reload Asset Allocation.');
		}
		if (request === generation) {
			AssetAllocationStore.set({ path, definition, ledgerVersion, ...criteria, engine });
			AssetAllocationLoadedAtStore.set(new Date());
		}
		return engine;
	} catch (error) {
		if (request === generation) clearAllocationCache();
		throw error;
	}
}
