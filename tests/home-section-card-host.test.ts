// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import CalculatorIcon from '@lucide/svelte/icons/calculator';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';
import type { HomeCardBodyLoader, HomeCardOption } from '#lib/navigation';
import FixtureBody from './fixtures/home-card-body.svelte';

vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
afterEach(cleanup);

function entry(id: string, label: string, loadBody: HomeCardBodyLoader): HomeCardOption {
	return { id, label, title: label, Icon: CalculatorIcon, path: '/calculator', loadBody };
}

test('only selected bodies load, in saved DOM order, and a failed body is isolated', async () => {
	const unselected = vi.fn(async () => ({ default: FixtureBody }));
	const delayed = Promise.withResolvers<{ default: typeof FixtureBody }>();
	const catalog = [
		entry('loading', 'Waiting card', () => delayed.promise),
		entry('unused', 'Unselected card', unselected),
		entry('broken', 'Failed card', async () => {
			throw new Error('No chunk');
		}),
		entry('ready', 'Working card', async () => ({ default: FixtureBody }))
	];
	const view = render(HomeSectionCards, {
		cards: ['broken', 'ready', 'loading', 'unknown'],
		catalog
	});
	expect(view.getAllByRole('heading').map((heading) => heading.textContent?.trim())).toEqual([
		'Failed card',
		'Working card',
		'Waiting card'
	]);
	expect(view.getByRole('link', { name: 'Working card' }).getAttribute('href')).toBe('/calculator');
	expect((await view.findByRole('alert')).textContent).toContain('Could not load Failed card.');
	expect(await view.findByRole('button', { name: 'Fixture card action' })).toBeDefined();
	expect(view.getByRole('status').textContent?.trim()).toBe('Loading Waiting card…');
	expect(unselected).not.toHaveBeenCalled();

	await view.rerender({ cards: ['loading', 'ready'] });
	delayed.resolve({ default: FixtureBody });
	await waitFor(() => expect(view.getAllByRole('button')).toHaveLength(2));
	expect(view.queryByRole('alert')).toBeNull();
	expect(view.getAllByRole('heading').map((heading) => heading.textContent?.trim())).toEqual([
		'Waiting card',
		'Working card'
	]);
});
