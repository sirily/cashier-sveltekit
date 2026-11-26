import { HomeCardNames } from '#lib/enums';
import ArrowLeftRightIcon from '@lucide/svelte/icons/arrow-left-right';
import CalculatorIcon from '@lucide/svelte/icons/calculator';
import ChartLineIcon from '@lucide/svelte/icons/chart-line';
import ChartNoAxesCombinedIcon from '@lucide/svelte/icons/chart-no-axes-combined';
import ChartPieIcon from '@lucide/svelte/icons/chart-pie';
import CircleQuestionMarkIcon from '@lucide/svelte/icons/circle-question-mark';
import ContainerIcon from '@lucide/svelte/icons/container';
import DatabaseIcon from '@lucide/svelte/icons/database';
import FolderOpenIcon from '@lucide/svelte/icons/folder-open';
import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
import HouseIcon from '@lucide/svelte/icons/house';
import InfoIcon from '@lucide/svelte/icons/info';
import LandmarkIcon from '@lucide/svelte/icons/landmark';
import ListTreeIcon from '@lucide/svelte/icons/list-tree';
import ScrollIcon from '@lucide/svelte/icons/scroll';
import SettingsIcon from '@lucide/svelte/icons/settings';
import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
import UsersRoundIcon from '@lucide/svelte/icons/users-round';
import WrenchIcon from '@lucide/svelte/icons/wrench';
import type { Component } from 'svelte';

export type HomeCardBodyLoader = () => Promise<{ default: Component }>;

type CardOptions = {
	id?: string;
	label?: string;
	title?: string;
	loadBody: HomeCardBodyLoader;
};

function section<Path extends string>(
	path: Path,
	label: string,
	Icon: typeof HouseIcon,
	card: CardOptions
) {
	return {
		path,
		label,
		Icon,
		card: {
			id: card.id ?? `shortcut:${path}`,
			label: card.label ?? label,
			title: card.title ?? card.label ?? label,
			loadBody: card.loadBody
		}
	};
}

export const primaryLinks = [
	{ path: '/', label: 'Home', Icon: HouseIcon },
	section('/accounts/groups', 'My Accounts', LandmarkIcon, {
		id: HomeCardNames.ACCOUNT_GROUPS,
		label: 'Account Groups',
		loadBody: () => import('#lib/components/AccountGroupsBody.svelte')
	}),
	section('/journal', 'Journal', ScrollIcon, {
		id: HomeCardNames.JOURNAL,
		title: 'Device Journal',
		loadBody: () => import('#lib/components/JournalBody.svelte')
	})
] as const;

export const drawerGroups = [
	{
		label: 'Analysis',
		Icon: ChartNoAxesCombinedIcon,
		links: [
			section('/reports', 'Reports', ChartLineIcon, {
				loadBody: () => import('#lib/components/ReportLinks.svelte')
			}),
			section('/accounts/tree', 'Account Tree', ListTreeIcon, {
				loadBody: () => import('#lib/components/AccountTreeBody.svelte')
			}),
			section('/accounts', 'Accounts', LandmarkIcon, {
				loadBody: () => import('#lib/components/AccountsBody.svelte')
			}),
			section('/asset-allocation', 'Asset Allocation', ChartPieIcon, {
				loadBody: () => import('#lib/components/AssetAllocationBody.svelte')
			}),
			section('/payees', 'Payees', UsersRoundIcon, {
				loadBody: () => import('#lib/components/PayeesBody.svelte')
			})
		]
	},
	{
		label: 'Data',
		Icon: HardDriveIcon,
		links: [
			section('/sync', 'Server Sync', ArrowLeftRightIcon, {
				loadBody: () => import('#lib/components/ServerSyncBody.svelte')
			}),
			section('/backup', 'Backup', DatabaseIcon, {
				loadBody: () => import('#lib/components/BackupBody.svelte')
			}),
			section('/opfs', 'File Storage', FolderOpenIcon, {
				loadBody: () => import('#lib/components/FileStorageBody.svelte')
			})
		]
	},
	{
		label: 'Utilities',
		Icon: WrenchIcon,
		links: [
			section('/tools/serialization', 'Serialization', ContainerIcon, {
				loadBody: () => import('#lib/components/SerializationBody.svelte')
			}),
			section('/calculator', 'Calculator', CalculatorIcon, {
				loadBody: () => import('#lib/components/CalculatorBody.svelte')
			}),
			section('/util/validation', 'Validation', ShieldCheckIcon, {
				loadBody: () => import('#lib/components/ValidationBody.svelte')
			})
		]
	}
] as const;

export const footerLinks = [
	section('/help', 'Help', CircleQuestionMarkIcon, {
		loadBody: () => import('#lib/components/HelpBody.svelte')
	}),
	section('/about', 'About', InfoIcon, {
		loadBody: () => import('#lib/components/AboutBody.svelte')
	}),
	section('/settings', 'Settings', SettingsIcon, {
		loadBody: () => import('#lib/components/SettingsBody.svelte')
	})
] as const;

export type DrawerLink =
	| (typeof primaryLinks)[number]
	| (typeof drawerGroups)[number]['links'][number]
	| (typeof footerLinks)[number];

type CardSection = Extract<DrawerLink, { card: object }>;

const drawerLinks: readonly DrawerLink[] = [
	...primaryLinks,
	...drawerGroups.flatMap<DrawerLink>(({ links }) => links),
	...footerLinks
];

export const homeCardOptions = drawerLinks
	.filter((link): link is CardSection => 'card' in link)
	.map(({ path, Icon, card }) => ({ path, Icon, ...card }));

export type HomeCardOption = (typeof homeCardOptions)[number];
