// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { get, writable } from 'svelte/store';
import init, { Ledger } from '@rustledger/wasm';
import Expenses from '../src/routes/reports/expenses/+page.svelte';
import IncomeExpense from '../src/routes/reports/income-expense/+page.svelte';

const mock = vi.hoisted(() => ({
	query: vi.fn(),
	getErrors: vi.fn(),
	ensureLoaded: vi.fn(),
	client: null as unknown as {
		version: ReturnType<typeof writable<number>>;
		isReloading: ReturnType<typeof writable<boolean>>;
		isLoaded: boolean;
	}
}));
vi.mock('#lib/services/ledgerWorkerClient', async () => {
	const { writable } = await import('svelte/store');
	mock.client = { version: writable(1), isReloading: writable(false), isLoaded: true };
	return {
		default: {
			...mock.client,
			get isLoaded() {
				return mock.client.isLoaded;
			},
			query: mock.query,
			getErrors: mock.getErrors,
			ensureLoaded: mock.ensureLoaded
		}
	};
});
vi.mock('#lib/settings', () => ({
	SettingKeys: { currency: 'currency' },
	settings: { get: async () => 'USD' }
}));
vi.mock('#lib/data/mainStore', async () => ({
	drawerState: (await import('svelte/store')).writable(false)
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

const accounts = `2000-01-01 open Assets:Cash
2000-01-01 open Expenses:Food
2000-01-01 open Income:Salary
`;
const valid = `2026-06-01 ! "Selected interpolated"
  Expenses:Food
  Assets:Cash -10 USD
2026-06-30 ! "Refund"
  Expenses:Food -2 USD
  Assets:Cash 2 USD
2026-06-10 ! "Income"
  Income:Salary
  Assets:Cash 100 USD
`;
const incomplete = `2026-06-12 ! "Fix me"
  Expenses:Food
  Assets:Cash
`;
let ledger: Ledger;
function useBook(overlay = '', selected = valid) {
	ledger?.free();
	ledger = Ledger.fromFiles(
		{
			'cashier.bean': `include "selected.bean"\n${overlay}`,
			'selected.bean': accounts + selected
		},
		'cashier.bean'
	);
	mock.query.mockImplementation(async (bql: string) => ledger.query(bql));
	mock.getErrors.mockImplementation(async () => ledger.getErrors());
}

beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-06-30T12:00:00Z'));
	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
	mock.query.mockReset();
	mock.getErrors.mockReset();
	mock.ensureLoaded.mockReset().mockResolvedValue(undefined);
	mock.client.isLoaded = true;
	mock.client.version.set(1);
	mock.client.isReloading.set(false);
	useBook();
});
afterEach(() => {
	cleanup();
	ledger.free();
	ledger = undefined as unknown as Ledger;
	vi.useRealTimers();
});

for (const [name, Page] of [
	['expenses', Expenses],
	['income-expense', IncomeExpense]
] as const) {
	describe(`${name} route with real WASM`, () => {
		test('first opening waits for ensureLoaded and survives its version increment', async () => {
			mock.client.isLoaded = false;
			mock.client.version.set(0);
			let ready!: () => void;
			mock.ensureLoaded.mockImplementationOnce(async () => {
				await new Promise<void>((resolve) => {
					ready = resolve;
				});
				mock.client.isLoaded = true;
				mock.client.version.update((v) => v + 1);
			});
			const view = render(Page);
			await waitFor(() => expect(ready).toBeTypeOf('function'));
			expect(mock.query).not.toHaveBeenCalled();
			expect(view.container.querySelector('canvas')).toBeNull();
			ready();
			await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull());
			expect(view.getAllByText(/8\.00 USD/).length).toBeGreaterThan(0);
		});

		test('unconfigured analysis is unavailable, not an empty report', async () => {
			mock.client.isLoaded = false;
			const view = render(Page);
			await waitFor(() => expect(view.getByText(/Ledger analysis is unavailable/)).toBeTruthy());
			expect(mock.query).not.toHaveBeenCalled();
			expect(view.queryByText(/No expense data|No data available/)).toBeNull();
		});

		test('shows incomplete explanation and accessible diagnostics, no total/chart/empty success; refreshes after correction', async () => {
			useBook(incomplete);
			const view = render(Page);
			await waitFor(() =>
				expect(view.getByRole('status').textContent).toContain('Report incomplete')
			);
			expect(view.container.querySelector('canvas')).toBeNull();
			expect(view.queryByText('Total:')).toBeNull();
			expect(view.queryByText(/No expense data|No data available/)).toBeNull();
			const summary = view.getByText(/Report diagnostics \(/);
			await fireEvent.click(summary);
			expect(view.getByText(/2026-06-12 · Expenses:Food · Fix me/).textContent).toContain(
				'Unresolved posting amount'
			);
			expect(view.getByText(/Transaction has 2 postings with missing amounts/)).toBeTruthy();
			expect(mock.query.mock.calls.every(([q]) => !q.includes('CONVERT'))).toBe(true);
			useBook();
			mock.client.version.update((v) => v + 1);
			await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull());
			expect(view.queryByRole('status')).toBeNull();
			expect(view.getAllByText(/8\.00 USD/).length).toBeGreaterThan(0);
			if (name === 'income-expense')
				expect(view.getAllByText(/100\.00 USD/).length).toBeGreaterThan(0);
		});

		test('converted signs and long symbols are included; unvalued original units hide all totals', async () => {
			useBook(
				`2026-06-15 ! "Converted income"
  Income:Salary -10 LONGCOIN
  Assets:Cash 10 LONGCOIN
2026-06-15 ! "Converted expense"
  Expenses:Food 5 LONGCOIN
  Assets:Cash -5 LONGCOIN
2026-06-16 ! "Converted refund"
  Expenses:Food -1 LONGCOIN
  Assets:Cash 1 LONGCOIN
`,
				valid + '2026-06-01 price LONGCOIN 2 USD\n'
			);
			const view = render(Page);
			await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull());
			expect(view.getAllByText(/16\.00 USD/).length).toBeGreaterThan(0);
			if (name === 'income-expense')
				expect(view.getAllByText(/120\.00 USD/).length).toBeGreaterThan(0);
			useBook(`2026-06-15 ! "No price"
  Expenses:Food 7 UNPRICED
  Assets:Cash -7 UNPRICED
`);
			mock.client.version.update((v) => v + 1);
			await waitFor(() => expect(view.getByRole('status')).toBeTruthy());
			expect(view.container.querySelector('canvas')).toBeNull();
			expect(view.queryByText(/16\.00 USD/)).toBeNull();
			expect(view.getByText(/original amount: 7 UNPRICED/)).toBeTruthy();
		});

		test('reload hides previously displayed results and reruns on isReloading without a version bump', async () => {
			const view = render(Page);
			await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull());
			const version = get(mock.client.version);
			mock.client.isReloading.set(true);
			await waitFor(() => expect(view.container.querySelector('canvas')).toBeNull());
			expect(view.queryByText('Total:')).toBeNull();
			useBook(incomplete);
			mock.client.isReloading.set(false);
			await waitFor(() =>
				expect(view.getByRole('status').textContent).toContain('Report incomplete')
			);
			expect(get(mock.client.version)).toBe(version);
		});

		if (name === 'income-expense')
			test('drill-down retains account and the actual report date bounds', async () => {
				vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
				const view = render(Page);
				await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull());
				await fireEvent.click(view.getByRole('button', { name: /Expenses/ }));
				const links = view.getAllByRole('link', { name: /All transactions — Jun 26/ });
				const url = new URL((links[0] as HTMLAnchorElement).href);
				expect(url.searchParams.get('account')).toBe('^Expenses');
				expect(url.searchParams.get('dateFrom')).toBe('2026-06-01');
				expect(url.searchParams.get('dateTo')).toBe('2026-06-15');
			});

		test('old query success cannot replace the new worker composition', async () => {
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			let started = false;
			mock.query.mockImplementationOnce(async (bql: string) => {
				const result = ledger.query(bql);
				started = true;
				await gate;
				return result;
			});
			const view = render(Page);
			await waitFor(() => expect(started).toBe(true));
			mock.client.isReloading.set(true);
			useBook(incomplete);
			mock.client.version.update((v) => v + 1);
			mock.client.isReloading.set(false);
			await waitFor(() =>
				expect(view.getByRole('status').textContent).toContain('Report incomplete')
			);
			release();
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(view.container.querySelector('canvas')).toBeNull();
			expect(view.getByRole('status').textContent).toContain('Report incomplete');
		});

		test('period selection supplies inclusive bounds and supersedes an older request', async () => {
			const view = render(Page);
			await waitFor(() => expect(view.container.querySelector('canvas')).not.toBeNull());
			let rejectOld!: (error: Error) => void;
			let started = false;
			mock.query.mockImplementationOnce(async () => {
				started = true;
				return new Promise((_, reject) => {
					rejectOld = reject;
				});
			});
			mock.client.version.update((v) => v + 1);
			await waitFor(() => expect(started).toBe(true));
			const select = view.container.querySelector('select')!;
			await fireEvent.change(select, {
				target: { value: name === 'expenses' ? 'last_month' : '2025' }
			});
			await waitFor(() =>
				expect(
					view.container.querySelector('canvas') !== null ||
						view.queryByText('No expense data for this period.') !== null
				).toBe(true)
			);
			const query = mock.query.mock.calls.at(-1)![0] as string;
			expect(query).toContain(
				name === 'expenses'
					? 'date >= 2026-05-01 AND date <= 2026-05-31'
					: 'date >= 2025-01-01 AND date <= 2025-12-31'
			);
			rejectOld(new Error('obsolete query failed'));
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(view.queryByText('obsolete query failed')).toBeNull();
		});
	});
}
