// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { get, writable } from 'svelte/store';
import CalculatorBody from '#lib/components/CalculatorBody.svelte';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';
import { selectionMetadata } from '#lib/data/mainStore';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/ledgerWorkerClient', () => ({
	default: { version: writable(1), isReloading: writable(false) }
}));
const { readBalances } = vi.hoisted(() => ({ readBalances: vi.fn() }));
vi.mock('#lib/services/calculatorBalances', () => ({
	readCalculatorAccounts: async () => ['Assets:Checking', 'Assets:Savings'],
	readCalculatorBalances: readBalances
}));

beforeAll(() => {
	// jsdom does not implement the native modal lifecycle used by the picker.
	Object.defineProperties(HTMLDialogElement.prototype, {
		showModal: {
			configurable: true,
			value(this: HTMLDialogElement) {
				this.open = true;
			}
		},
		close: {
			configurable: true,
			value(this: HTMLDialogElement) {
				this.open = false;
				this.dispatchEvent(new Event('close'));
			}
		}
	});
});

afterAll(() => {
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
	Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

afterEach(() => {
	cleanup();
	selectionMetadata.set(undefined);
	vi.resetAllMocks();
});

test('Home selects independent account balances, edits an earlier operand and cancels without changes', async () => {
	const selection = {
		origin: '',
		selectionType: 'amount',
		initialValue: '99',
		selectedId: undefined
	};
	selectionMetadata.set(selection);
	readBalances.mockImplementation(async (account: string) =>
		account === 'Assets:Checking'
			? [
					{ amount: '120', currency: 'EUR' },
					{ amount: '14', currency: 'USD' }
				]
			: [{ amount: '-35.5', currency: 'EUR' }]
	);
	const view = render(HomeSectionCards, { cards: ['shortcut:/calculator'] });
	const picker = await view.findByRole('button', { name: 'Insert account balance' });
	async function choose(account: string, amount: string) {
		await fireEvent.click(picker);
		const dialog = within(view.getByRole('dialog'));
		await fireEvent.click(await dialog.findByRole('button', { name: account }));
		await fireEvent.click(await dialog.findByRole('button', { name: amount }));
	}
	const result = view.getByRole('status', { name: 'Calculator result' });
	await choose('Assets:Checking', '120 EUR');
	await fireEvent.click(view.getByRole('button', { name: '-' }));
	await choose('Assets:Savings', '-35.5 EUR');
	await fireEvent.click(view.getByRole('button', { name: '=' }));
	expect(result).toHaveProperty('textContent', '155.5');
	await fireEvent.click(view.getByRole('button', { name: 'Select operand 1: 120 EUR' }));
	await fireEvent.click(picker);
	await fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
	await view.findByRole('button', { name: 'Select operand 1: 120 EUR' });
	expect(result).toHaveProperty('textContent', '155.5');
	await choose('Assets:Checking', '14 USD');
	await fireEvent.click(view.getByRole('button', { name: '=' }));
	expect(result).toHaveProperty('textContent', '49.5');
	expect(get(selectionMetadata)).toBe(selection);
	expect(selection.selectedId).toBeUndefined();
	expect(view.queryByRole('button', { name: 'Apply amount' })).toBeNull();
});

test('an unavailable balance does not alter the expression or stop manual calculation', async () => {
	readBalances.mockRejectedValue(new Error('No local book loaded.'));
	const view = render(CalculatorBody, { account: 'Assets:Checking', initialValue: '2' });
	await fireEvent.click(view.getByRole('button', { name: 'Insert account balance' }));
	expect((await view.findByRole('alert')).textContent).toContain('No local book loaded.');
	await fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
	await view.findByRole('button', { name: '+' });
	for (const name of ['+', '3', '=']) await fireEvent.click(view.getByRole('button', { name }));
	expect(view.getByRole('status', { name: 'Calculator result' })).toHaveProperty(
		'textContent',
		'5'
	);
});

test.each([
	[['2', '0', '0', '-', '1', '9', '8', '.', '2', '8', '='], '1.72'],
	[['(', '2', '+', '3', ')', '×', '4', '='], '20'],
	[['+/-', '(', '2', '+', '3', ')', '='], '-5'],
	[['2', '×', '+/-', '(', '1', '+', '3', ')', '='], '-8'],
	[['+/-', '(', '⌫', '2', '='], '-2'],
	[['2', '0', '0', '÷', '8', '%', '=', '+', '2', '='], '2502']
])('calculates %j as %s', async (keys, expected) => {
	const view = render(CalculatorBody);
	for (const key of keys) await fireEvent.click(view.getByRole('button', { name: key }));
	expect(view.getByRole('status', { name: 'Calculator result' })).toHaveProperty(
		'textContent',
		expected
	);
});
