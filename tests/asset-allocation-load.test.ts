import { beforeEach, expect, test, vi } from 'vitest';
import { writable } from 'svelte/store';
import {
	loadAssetAllocation,
	resetAssetAllocation
} from '#lib/assetAllocation/loadAssetAllocation';

const mocks = vi.hoisted(() => ({ definition: vi.fn(), calculate: vi.fn() }));
const version = writable(0);
vi.mock('#lib/services/ledgerWorkerClient', () => ({
	default: {
		ensureLoaded: async () => {},
		isLoaded: true,
		get version() {
			return version;
		}
	}
}));
vi.mock('#lib/settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/settings')>()),
	settings: { get: async () => 'allocation.toml' }
}));
vi.mock('#lib/utils/opfslib', () => ({ readFile: mocks.definition }));
vi.mock('#lib/assetAllocation/AssetAllocation', () => ({
	AssetAllocationEngine: class {
		assetClasses = [{ name: 'Allocation' }];
		loadFullAssetAllocation = mocks.calculate;
	}
}));

beforeEach(() => {
	resetAssetAllocation();
	version.set(1);
	mocks.definition.mockReset().mockResolvedValue('[Allocation]');
	mocks.calculate.mockReset().mockResolvedValue(undefined);
});

test('allocation is recomputed when the local book version or definition changes', async () => {
	const first = await loadAssetAllocation();
	expect(await loadAssetAllocation()).toBe(first);
	expect(mocks.calculate).toHaveBeenCalledOnce();
	version.set(2);
	const updated = await loadAssetAllocation();
	expect(updated).not.toBe(first);
	mocks.definition.mockResolvedValue('[Allocation]\nallocation = 100');
	expect(await loadAssetAllocation()).not.toBe(updated);
	expect(mocks.calculate).toHaveBeenCalledTimes(3);
});

test('an older book calculation cannot replace the current result in the shared cache', async () => {
	const oldCalculation = Promise.withResolvers<void>();
	mocks.calculate.mockReturnValueOnce(oldCalculation.promise);
	const first = loadAssetAllocation();
	await vi.waitFor(() => expect(mocks.calculate).toHaveBeenCalledOnce());
	version.set(2);
	const updated = await loadAssetAllocation();
	oldCalculation.resolve();
	await first;
	expect(await loadAssetAllocation()).toBe(updated);
	expect(mocks.calculate).toHaveBeenCalledTimes(2);
});
