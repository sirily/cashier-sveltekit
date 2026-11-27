// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import { get } from 'svelte/store';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';
import CalculatorPage from '../src/routes/calculator/+page.svelte';
import { selectionMetadata, xact } from '#lib/data/mainStore';
import { Xact } from '#lib/data/model';
import { SelectionModeMetadata } from '#lib/settings';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
afterEach(() => {
	cleanup();
	selectionMetadata.set(undefined);
});

test('the Home calculator works without reading or applying an editor selection', async () => {
	const editor = Xact.create();
	editor.postings[0].amount = 100;
	xact.set(editor);
	const selection = Object.assign(new SelectionModeMetadata(), {
		initialValue: 100,
		postingIndex: 0,
		selectionType: 'amount'
	});
	selectionMetadata.set(selection);
	const back = vi.spyOn(history, 'back').mockImplementation(() => {});
	const view = render(HomeSectionCards, { cards: ['shortcut:/calculator'] });
	const result = await view.findByRole('status', { name: 'Calculator result' });
	expect(result.textContent?.trim()).toBe('0');
	for (const name of [/^2$/, /^\+$/, /^3$/, /^=$/]) {
		await fireEvent.click(view.getByRole('button', { name }));
	}
	expect(result.textContent?.trim()).toBe('5');
	expect(view.queryByRole('button', { name: 'Apply amount' })).toBeNull();
	expect(get(selectionMetadata)).toBe(selection);
	expect(selection.selectedId).toBeUndefined();
	expect(get(xact).postings[0].amount).toBe(100);
	expect(back).not.toHaveBeenCalled();
});

test.each(['account', 'payee'])(
	'standalone calculator ignores %s picker metadata',
	async (selectionType) => {
		const selection = Object.assign(new SelectionModeMetadata(), {
			initialValue: 100,
			selectionType
		});
		selectionMetadata.set(selection);
		const back = vi.spyOn(history, 'back').mockImplementation(() => {});
		const view = render(CalculatorPage);
		expect(view.getByRole('status', { name: 'Calculator result' }).textContent?.trim()).toBe('0');
		await fireEvent.click(view.getByRole('button', { name: /^5$/ }));
		await fireEvent.click(view.getByRole('button', { name: /^=$/ }));
		expect(view.queryByRole('button', { name: 'Apply amount' })).toBeNull();
		expect(selection.selectedId).toBeUndefined();
		expect(back).not.toHaveBeenCalled();
	}
);

test('the standalone calculator returns an explicit amount selection', async () => {
	const selection = Object.assign(new SelectionModeMetadata(), {
		initialValue: 100,
		selectionType: 'amount'
	});
	selectionMetadata.set(selection);
	const back = vi.spyOn(history, 'back').mockImplementation(() => {});
	const view = render(CalculatorPage);
	await fireEvent.click(view.getByRole('button', { name: 'Apply amount' }));
	expect(selection.selectedId).toBe(100);
	expect(back).toHaveBeenCalledOnce();
});
