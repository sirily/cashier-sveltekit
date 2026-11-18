import { get } from 'svelte/store';
import {
	AaStocksStore,
	AssetAllocationLoadedAtStore,
	AssetAllocationStore
} from '#lib/data/mainStore';
import { SettingKeys, settings } from '#lib/settings';
import { AppError, UserError } from '#lib/utils/errors';
import { readFile } from '#lib/utils/opfslib';
import { AssetAllocationEngine } from './AssetAllocation';

export function resetAssetAllocation() {
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
	const { path, definition } = await readDefinition().catch((error: unknown) => {
		resetAssetAllocation();
		throw error;
	});
	const cached = get(AssetAllocationStore);
	if (cached?.path === path && cached.definition === definition) return cached.engine;

	resetAssetAllocation();
	const aa = new AssetAllocationEngine();
	try {
		await aa.loadFullAssetAllocation(definition);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new UserError(
			`Could not load asset allocation definition "${path}": ${reason}`,
			error instanceof AppError ? error.action : undefined
		);
	}
	if (!aa.assetClasses.length) {
		throw new UserError(
			`Asset allocation definition "${path}" has no classes.`,
			'Add a top-level [Allocation] section.'
		);
	}

	AssetAllocationStore.set({ path, definition, engine: aa });
	AssetAllocationLoadedAtStore.set(new Date());
	return aa;
}
