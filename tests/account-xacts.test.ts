import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
	fullDirectives: [] as any[],
	device: [] as Array<{ xact: any; span: any }>
}));

vi.mock('$lib/services/ledgerWorkerClient', () => ({
	default: {
		ensureLoaded: vi.fn(async () => {}),
		getAccountWithBalances: vi.fn(async () => null),
		getDirectives: vi.fn(async () => state.fullDirectives)
	}
}));

vi.mock('$lib/services/ledgerService.js', () => ({
	default: {
		load: vi.fn(async () => {}),
		getXactsWithSpans: vi.fn(async () => state.device)
	}
}));

import { load } from '../src/routes/accounts/account-xacts/[accountName]/+page';

describe('account transaction rows', () => {
	beforeEach(() => {
		state.fullDirectives = [];
		state.device = [];
	});

	test('shows a server-only transaction once after a clean import', async () => {
		state.fullDirectives = [
			{
				type: 'transaction',
				date: '2026-08-21',
				payee: 'Transfer',
				narration: '',
				postings: [
					{ account: 'Assets:Bank:Sberbank', units: { number: '-8473.03', currency: 'RUB' } },
					{ account: 'Assets:Bank:Sberbank', units: { number: '-100', currency: 'RUB' } },
					{ account: 'Assets:Bank:MBT', units: { number: '100', currency: 'USD' } }
				]
			}
		];

		const result = await load({ params: { accountName: 'Assets:Bank:Sberbank' } } as any);

		expect(result.unifiedRows).toEqual([
			expect.objectContaining({
				date: '2026-08-21',
				payee: 'Transfer',
				amount: -8573.03,
				currency: 'RUB',
				isDevice: false
			})
		]);
	});
});
