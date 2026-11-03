// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';

const state = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock('$app/state', () => ({ page: { params: { dataType: 'journal' } } }));
vi.mock('#lib/utils/opfslib', () => ({ readFile: async (name: string) => state.files.get(name) }));
vi.mock('#lib/utils/notifier', () => ({ default: { init: vi.fn(), success: vi.fn() } }));
import Page from '../src/routes/export/[dataType=exportType]/+page.svelte';

const journal = `2026-11-01 ! "Shop" "Keep pending entry"
  cashier_id: "export-local-id"
  Expenses:Food 12.50 GBP
  Assets:Cash -12.50 GBP
2026-11-02 * "Shop" "Keep another identity"
  cashier_id: "export-other-id"
  Expenses:Food 20 RUB
  Assets:Cash -20 RUB
`;
beforeEach(() => {
	state.files = new Map([
		['cashier.bean', journal],
		['book.bean', '2000-01-01 open Assets:Cash\n']
	]);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test('journal copy, share and download preserve Beancount content and identities with a .bean filename', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 10, 3, 12, 34, 56));
	const before = new Map(state.files);
	const writeText = vi.fn(async (_text: string) => {});
	const share = vi.fn(async (_data: ShareData) => {});
	vi.stubGlobal('navigator', { clipboard: { writeText }, share, canShare: () => true });
	vi.stubGlobal('isSecureContext', true);
	vi.stubGlobal('Blob', NodeBlob);
	const createObjectURL = vi.fn((_blob: Blob) => 'blob:journal-test');
	const revokeObjectURL = vi.fn();
	vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
	let downloadedName = '';
	let downloadedHref = '';
	const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		downloadedName = this.download;
		downloadedHref = this.href;
	});

	const view = render(Page);
	await waitFor(() =>
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(journal)
	);
	expect(view.getByText(/Journal is exported in Beancount format/)).toBeTruthy();
	await fireEvent.click(view.getByRole('button', { name: 'Copy' }));
	expect(writeText).toHaveBeenCalledWith(journal);
	await fireEvent.click(view.getByRole('button', { name: 'Share' }));
	expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: journal }));
	await fireEvent.click(view.getByRole('button', { name: 'Download' }));
	expect(click).toHaveBeenCalledOnce();
	expect(downloadedName).toBe('journal_2026-11-03_123456.bean');
	expect(downloadedHref).toBe('blob:journal-test');
	const blob = createObjectURL.mock.calls[0][0];
	expect(await blob.text()).toBe(journal);
	expect(blob.type).toBe('text/plain');
	expect(revokeObjectURL).toHaveBeenCalledWith('blob:journal-test');
	expect(state.files).toEqual(before);
	expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(journal);
});
