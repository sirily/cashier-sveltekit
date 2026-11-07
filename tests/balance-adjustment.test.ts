// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import init from '@rustledger/wasm';
import Page from '../src/routes/accounts/bal-adj/+page.svelte';

const mocks = vi.hoisted(() => ({
	balance: vi.fn(),
	load: vi.fn(),
	goto: vi.fn(),
	currency: vi.fn(),
	engineReady: vi.fn()
}));
vi.mock('#lib/services/rustledger', async () => {
	const wasm = await import('@rustledger/wasm');
	return {
		ensureInitialized: mocks.engineReady,
		createParsedLedger: (source: string) => new wasm.ParsedLedger(source)
	};
});
beforeAll(async () => {
	await init({
		module_or_path: readFileSync(
			new URL(import.meta.resolve('@rustledger/wasm/rustledger_wasm_bg.wasm'))
		)
	});
});
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/accounts/bal-adj?account=Assets:Cash') }
}));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/ledgerWorkerClient', () => ({
	default: {
		ensureLoaded: mocks.load,
		query: mocks.balance,
		getErrors: async () => [],
		getAllAccounts: async () => [{ name: 'Assets:Cash' }]
	}
}));
vi.mock('#lib/services/appService', () => ({ default: { getDefaultCurrency: mocks.currency } }));
vi.mock('#lib/data/mainStore', async () => {
	const { writable } = await import('svelte/store');
	return {
		xact: writable(undefined),
		xactSpan: writable(undefined),
		selectionMetadata: writable(undefined),
		drawerState: writable(false)
	};
});
afterEach(cleanup);

for (const result of [
	{ columns: ['balance', 'currency'], rows: [[null, 'USD']], errors: [] },
	{ columns: ['balance', 'currency'], rows: [], errors: ['Query failed'] },
	{ columns: [], rows: [], errors: [] }
]) {
	test(`unresolved baseline blocks creation: ${JSON.stringify(result)}`, async () => {
		mocks.balance.mockResolvedValue(result);
		const view = render(Page);
		await waitFor(() =>
			expect(view.getByRole('alert').textContent).toContain('Balance unavailable')
		);
		expect(view.container.querySelector('button.fixed')).toBeNull();
		expect(mocks.goto).not.toHaveBeenCalled();
	});
}
test('successful empty account query proves zero, unlike a failed load', async () => {
	mocks.balance.mockResolvedValue({ columns: ['balance', 'currency'], rows: [], errors: [] });
	const view = render(Page);
	await waitFor(() => expect(view.getByLabelText('Current Balance')).toHaveProperty('value', '0'));
	await fireEvent.input(view.getByLabelText('Current Balance'), { target: { value: '70' } });
	expect(view.container.textContent).toContain('+70.00');
});
test('load failure never becomes a zero baseline', async () => {
	mocks.load.mockRejectedValue(new Error('Missing selected book'));
	const view = render(Page);
	await waitFor(() =>
		expect(view.getByRole('alert').textContent).toContain('Missing selected book')
	);
	expect(view.container.querySelector('button.fixed')).toBeNull();
});
beforeEach(async () => {
	const { xact, selectionMetadata } = await import('../src/lib/data/mainStore');
	xact.set(undefined as never);
	selectionMetadata.set(undefined);
	vi.clearAllMocks();
	mocks.load.mockResolvedValue(undefined);
	mocks.engineReady.mockResolvedValue(undefined);
	mocks.currency.mockResolvedValue('GBP');
	mocks.balance.mockResolvedValue({
		columns: ['balance', 'currency'],
		rows: [
			[290, 'GBP'],
			[66.81, 'USD']
		],
		errors: []
	});
});
test('currency switch uses USD 66.81, then restores GBP 290', async () => {
	const view = render(Page);
	await waitFor(() =>
		expect(view.getByLabelText('Current Balance')).toHaveProperty('value', '290')
	);
	await fireEvent.input(view.getByPlaceholderText('EUR'), { target: { value: 'USD' } });
	await fireEvent.input(view.getByLabelText('Current Balance'), { target: { value: '70' } });
	await waitFor(() => expect(view.container.textContent).toContain('+3.19'));
	expect(view.container.textContent).toContain('66.81');
	await fireEvent.input(view.getByPlaceholderText('EUR'), { target: { value: 'GBP' } });
	await waitFor(() => expect(view.container.textContent).toContain('-220.00'));
});

function deferredBalance() {
	let finish!: (value: unknown) => void;
	mocks.balance.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		})
	);
	return () =>
		finish({
			columns: ['balance', 'currency'],
			rows: [
				[290, 'GBP'],
				[66.81, 'USD']
			],
			errors: []
		});
}

test('initial pending balances do not expose editable inputs before defaults are ready', async () => {
	const finish = deferredBalance();
	const view = render(Page);
	await waitFor(() => expect(mocks.balance).toHaveBeenCalled());
	expect(view.getByLabelText('Current Balance').matches(':disabled')).toBe(true);
	expect(view.getByPlaceholderText('EUR').matches(':disabled')).toBe(true);
	finish();
	await waitFor(() =>
		expect(view.getByLabelText('Current Balance')).toHaveProperty('value', '290')
	);
	expect(view.getByLabelText('Current Balance').matches(':disabled')).toBe(false);
	await fireEvent.input(view.getByPlaceholderText('EUR'), { target: { value: 'USD' } });
	await fireEvent.input(view.getByLabelText('Current Balance'), { target: { value: '70' } });
	expect(view.container.textContent).toContain('+3.19');
});

for (const unmount of [false, true]) {
	test(`pending balance completion cannot mutate replacement transaction (unmount=${unmount})`, async () => {
		const { xact } = await import('../src/lib/data/mainStore');
		const { Xact, Posting } = await import('../src/lib/data/model');
		const finish = deferredBalance();
		const view = render(Page);
		await waitFor(() => expect(mocks.balance).toHaveBeenCalled());
		if (unmount) view.unmount();
		const replacement = new Xact();
		replacement.note = 'Replacement must survive';
		replacement.postings = [new Posting(), new Posting()];
		replacement.postings[0].currency = 'XAU';
		xact.set(replacement);
		finish();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(replacement.postings[0].currency).toBe('XAU');
		expect(replacement.note).toBe('Replacement must survive');
	});
}

test('unmounted initial query leaves its original transaction untouched', async () => {
	const { xact } = await import('../src/lib/data/mainStore');
	const { get } = await import('svelte/store');
	mocks.currency.mockResolvedValue('EUR');
	const finish = deferredBalance();
	const view = render(Page);
	await waitFor(() => expect(mocks.balance).toHaveBeenCalled());
	const original = get(xact);
	view.unmount();
	finish();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(original.postings[0].currency).toBe('EUR');
});

test('navigation during default-currency lookup cannot replace a later transaction', async () => {
	const { xact } = await import('../src/lib/data/mainStore');
	const { get } = await import('svelte/store');
	const { Xact } = await import('../src/lib/data/model');
	let finish!: (currency: string) => void;
	mocks.currency.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		})
	);
	const view = render(Page);
	await waitFor(() => expect(mocks.currency).toHaveBeenCalled());
	view.unmount();
	const replacement = new Xact();
	replacement.note = 'Other editor';
	xact.set(replacement);
	finish('GBP');
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(get(xact)).toBe(replacement);
	expect(mocks.balance).not.toHaveBeenCalled();
});

for (const currency of [
	'US D',
	'1USD',
	'USD/GBP',
	'',
	'USD;',
	'USD-',
	'CAC_',
	'ABC.',
	"ABC'",
	'/6.3',
	'/123',
	'/'
]) {
	test(`invalid commodity ${JSON.stringify(currency)} never becomes zero`, async () => {
		const view = render(Page);
		await waitFor(() =>
			expect(view.getByLabelText('Current Balance')).toHaveProperty('value', '290')
		);
		await fireEvent.input(view.getByPlaceholderText('EUR'), { target: { value: currency } });
		await fireEvent.input(view.getByLabelText('Current Balance'), { target: { value: '70' } });
		expect(view.getByRole('alert').textContent).toContain('valid commodity');
		expect(view.container.querySelector('button.fixed')).toBeNull();
		expect(view.container.textContent).not.toContain('+70.00');
	});
}
for (const currency of [
	'BRK.B',
	'TEST_FUND',
	'ABC-1',
	"ABC'D",
	'XAU',
	'/6J',
	'/USD',
	'/NQH21',
	'/NQH21_QNEG21C13100',
	'V'
]) {
	test(`valid absent commodity ${currency} has proven zero and requires faithful local-engine serialization`, async () => {
		const { xact } = await import('../src/lib/data/mainStore');
		const { get } = await import('svelte/store');
		const { xactToBeancountText } = await import('../src/lib/utils/xactUtils');
		const view = render(Page);
		await waitFor(() =>
			expect(view.getByLabelText('Current Balance')).toHaveProperty('value', '290')
		);
		await fireEvent.input(view.getByPlaceholderText('EUR'), { target: { value: currency } });
		await fireEvent.input(view.getByLabelText('Current Balance'), { target: { value: '70' } });
		get(xact).postings[0].account = 'Expenses:Adjustment';
		await fireEvent.click(view.container.querySelector('button.fixed')!);
		if (currency === '/6J') {
			await waitFor(() => expect(view.getByRole('alert').textContent).toContain('local engine'));
			expect(mocks.goto).not.toHaveBeenCalled();
			expect(get(xact).postings[0].amount).not.toBe(-70);
			return;
		}
		await waitFor(() => expect(mocks.goto).toHaveBeenCalled());
		const tx = get(xact);
		expect(tx.postings.map((p) => [p.amount, p.currency])).toEqual([
			[-70, currency],
			[70, currency]
		]);
		expect(xactToBeancountText(tx)).toContain('70 ' + currency);
	});
}

for (const unmount of [false, true]) {
	test(`engine initialization cannot hand off a replacement transaction (unmount=${unmount})`, async () => {
		const { xact } = await import('../src/lib/data/mainStore');
		const { get } = await import('svelte/store');
		const { Xact } = await import('../src/lib/data/model');
		let finish!: () => void;
		mocks.engineReady.mockReturnValue(
			new Promise<void>((resolve) => {
				finish = resolve;
			})
		);
		const view = render(Page);
		await waitFor(() =>
			expect(view.getByLabelText('Current Balance')).toHaveProperty('value', '290')
		);
		get(xact).postings[0].account = 'Expenses:Adjustment';
		await fireEvent.input(view.getByLabelText('Current Balance'), { target: { value: '300' } });
		await fireEvent.click(view.container.querySelector('button.fixed')!);
		expect(view.getByLabelText('Current Balance').matches(':disabled')).toBe(true);
		if (unmount) view.unmount();
		const replacement = new Xact();
		replacement.note = 'Another editor';
		replacement.postings = structuredClone(get(xact).postings);
		xact.set(replacement);
		finish();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(get(xact)).toBe(replacement);
		expect(mocks.goto).not.toHaveBeenCalled();
	});
}
