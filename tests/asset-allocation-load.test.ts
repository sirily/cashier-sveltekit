import { beforeEach, expect, test, vi } from 'vitest';
import { writable } from 'svelte/store';
import {
	loadAssetAllocation,
	resetAssetAllocation
} from '#lib/assetAllocation/loadAssetAllocation';

const mocks = vi.hoisted(() => ({ definition: vi.fn(), calculate: vi.fn(), setting: vi.fn() }));
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
	settings: { get: mocks.setting }
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
	mocks.setting.mockReset().mockImplementation(
		async (key: string) =>
			({
				'aa.definition': 'allocation.toml',
				'aa.rootAccount': 'Assets:Investments',
				currency: 'EUR'
			})[key]
	);
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
	const stale = expect(first).rejects.toThrow('The local book changed during valuation');
	oldCalculation.resolve();
	await stale;
	expect(await loadAssetAllocation()).toBe(updated);
	expect(mocks.calculate).toHaveBeenCalledTimes(2);
});

function setCriteria(rootAccount: string, currency: string) {
	mocks.setting.mockImplementation(
		async (key: string) =>
			({
				'aa.definition': 'allocation.toml',
				'aa.rootAccount': rootAccount,
				currency
			})[key]
	);
}

test('unchanged definition and book do not hide changes to currency or root', async () => {
	const first = await loadAssetAllocation();
	setCriteria('Assets:Investments', 'USD');
	const second = await loadAssetAllocation();
	expect(second).not.toBe(first);
	setCriteria('Assets:Other', 'USD');
	const third = await loadAssetAllocation();
	expect(third).not.toBe(second);
	expect(await loadAssetAllocation()).toBe(third);
	expect(mocks.calculate.mock.calls.map(([, criteria]) => criteria)).toEqual([
		{ rootAccount: 'Assets:Investments', currency: 'EUR' },
		{ rootAccount: 'Assets:Investments', currency: 'USD' },
		{ rootAccount: 'Assets:Other', currency: 'USD' }
	]);
});

test('a late definition read cannot overwrite a newer snapshot with the same book', async () => {
	const delayedDefinition = Promise.withResolvers<string>();
	mocks.definition.mockReturnValueOnce(delayedDefinition.promise);
	const first = loadAssetAllocation();
	await vi.waitFor(() => expect(mocks.definition).toHaveBeenCalledOnce());
	setCriteria('Assets:Other', 'USD');
	const current = await loadAssetAllocation();
	delayedDefinition.resolve('[Allocation]');
	await first;
	expect(await loadAssetAllocation()).toBe(current);
	expect(mocks.calculate).toHaveBeenCalledTimes(2);
});
