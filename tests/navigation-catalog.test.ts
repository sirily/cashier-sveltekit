import { expect, test, vi } from 'vitest';
import { drawerGroups, footerLinks, homeCardOptions, primaryLinks } from '#lib/navigation';

const loadReports = vi.hoisted(() => vi.fn());
vi.mock('#lib/components/ReportLinks.svelte', () => ({ default: loadReports() }));

test('drawer keeps its visible labels, groups, and destinations', () => {
	const entries = (links: readonly { label: string; path: string }[]) =>
		links.map(({ label, path }) => [label, path]);
	expect(entries(primaryLinks)).toEqual([
		['Home', '/'],
		['My Accounts', '/accounts/groups'],
		['Journal', '/journal']
	]);
	expect(drawerGroups.map(({ label, links }) => [label, entries(links)])).toEqual([
		[
			'Analysis',
			[
				['Reports', '/reports'],
				['Account Tree', '/accounts/tree'],
				['Accounts', '/accounts'],
				['Asset Allocation', '/asset-allocation'],
				['Payees', '/payees']
			]
		],
		[
			'Data',
			[
				['Server Sync', '/sync'],
				['Backup', '/backup'],
				['File Storage', '/opfs']
			]
		],
		[
			'Utilities',
			[
				['Serialization', '/tools/serialization'],
				['Calculator', '/calculator'],
				['Validation', '/util/validation']
			]
		]
	]);
	expect(entries(footerLinks)).toEqual([
		['Help', '/help'],
		['About', '/about'],
		['Settings', '/settings']
	]);
});

test('each non-Home destination supplies one persistent card choice', () => {
	const destinations = [
		...primaryLinks.slice(1),
		...drawerGroups.flatMap<{ path: string }>(({ links }) => links),
		...footerLinks
	];
	expect(homeCardOptions.map(({ path }) => path)).toEqual(destinations.map(({ path }) => path));
	const ids = homeCardOptions.map(({ id }) => id);
	expect(new Set(ids).size).toBe(ids.length);
	expect(homeCardOptions.filter(({ path }) => path === '/accounts/groups')).toEqual([
		expect.objectContaining({ id: 'AccountGroupsCard', label: 'Account Groups' })
	]);
	expect(homeCardOptions.filter(({ path }) => path === '/journal')).toEqual([
		expect.objectContaining({ id: 'JournalCard', label: 'Journal' })
	]);
	expect(ids.slice(2)).toEqual(destinations.slice(2).map(({ path }) => `shortcut:${path}`));
});

test('reading navigation does not import the Reports body', async () => {
	const reports = homeCardOptions.find(({ path }) => path === '/reports');
	expect(loadReports).not.toHaveBeenCalled();
	expect(reports?.loadBody).toBeTypeOf('function');
	await reports?.loadBody?.();
	expect(loadReports).toHaveBeenCalledOnce();
});
