// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';

const mocks = vi.hoisted(() => ({ goto: vi.fn(), list: vi.fn(), manifest: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('#lib/utils/opfslib', () => ({ listFileTree: mocks.list }));
vi.mock('#lib/utils/importManifest', () => ({ getManifest: mocks.manifest }));
afterEach(cleanup);

test('Home browses marked local files and opens the existing editor without mutation controls', async () => {
	const path = 'books/My File.bean';
	mocks.list.mockResolvedValue([
		{ name: 'books', kind: 'directory', path: 'books', depth: 0 },
		{ name: 'My File.bean', kind: 'file', path, depth: 1, size: 50, lastModified: 100 }
	]);
	mocks.manifest.mockResolvedValue(new Map([[path, { importedAt: 50 }]]));
	const view = render(HomeSectionCards, { cards: ['shortcut:/opfs'] });
	const folder = await view.findByRole('button', { name: 'books' });
	expect(folder.getAttribute('aria-expanded')).toBe('false');
	expect(view.queryByRole('button', { name: 'My File.bean' })).toBeNull();
	expect(view.queryByRole('button', { name: /Delete|New File/ })).toBeNull();
	await fireEvent.click(folder);
	expect(folder.getAttribute('aria-expanded')).toBe('true');
	expect(view.getByTitle('Modified locally since last sync')).toBeDefined();
	await fireEvent.click(view.getByRole('button', { name: 'My File.bean' }));
	expect(mocks.goto).toHaveBeenCalledExactlyOnceWith('/opfs/edit-file?file=books%2FMy+File.bean');
});

test('a failed file-tree read shows an error rather than an empty tree', async () => {
	mocks.list.mockRejectedValueOnce(new Error('Storage access denied'));
	const view = render(HomeSectionCards, { cards: ['shortcut:/opfs'] });
	expect((await view.findByRole('alert')).textContent).toContain('Storage access denied');
	expect(view.queryByText('No files found in OPFS storage.')).toBeNull();
});
