// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

test('Home includes the setup guidance and version without page-level update controls', async () => {
	vi.stubGlobal('__BUILD_VERSION__', 'v1.2.1 (test)');
	const view = render(HomeSectionCards, { cards: ['shortcut:/help', 'shortcut:/about'] });
	expect(await view.findByRole('heading', { name: 'Using Cashier' })).toBeDefined();
	expect((await view.findByRole('heading', { name: 'Set up Asset Allocation' })).id).toBe(
		'asset-allocation'
	);
	expect(await view.findByText('v1.2.1 (test)')).toBeDefined();
	expect(view.getByRole('link', { name: 'GitHub' }).getAttribute('href')).toBe(
		'https://github.com/sirily/cashier-sveltekit'
	);
	expect(view.queryByRole('button', { name: 'Check for updates' })).toBeNull();
});
