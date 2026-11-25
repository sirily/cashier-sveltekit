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

export const primaryLinks = [
	{ path: '/', label: 'Home', Icon: HouseIcon },
	{ path: '/accounts/groups', label: 'My Accounts', Icon: LandmarkIcon },
	{ path: '/journal', label: 'Journal', Icon: ScrollIcon }
] as const;

export const drawerGroups = [
	{
		label: 'Analysis',
		Icon: ChartNoAxesCombinedIcon,
		links: [
			{ path: '/reports', label: 'Reports', Icon: ChartLineIcon },
			{ path: '/accounts/tree', label: 'Account Tree', Icon: ListTreeIcon },
			{ path: '/accounts', label: 'Accounts', Icon: LandmarkIcon },
			{ path: '/asset-allocation', label: 'Asset Allocation', Icon: ChartPieIcon },
			{ path: '/payees', label: 'Payees', Icon: UsersRoundIcon }
		]
	},
	{
		label: 'Data',
		Icon: HardDriveIcon,
		links: [
			{ path: '/sync', label: 'Server Sync', Icon: ArrowLeftRightIcon },
			{ path: '/backup', label: 'Backup', Icon: DatabaseIcon },
			{ path: '/opfs', label: 'File Storage', Icon: FolderOpenIcon }
		]
	},
	{
		label: 'Utilities',
		Icon: WrenchIcon,
		links: [
			{ path: '/tools/serialization', label: 'Serialization', Icon: ContainerIcon },
			{ path: '/calculator', label: 'Calculator', Icon: CalculatorIcon },
			{ path: '/util/validation', label: 'Validation', Icon: ShieldCheckIcon }
		]
	}
] as const;

export const footerLinks = [
	{ path: '/help', label: 'Help', Icon: CircleQuestionMarkIcon },
	{ path: '/about', label: 'About', Icon: InfoIcon },
	{ path: '/settings', label: 'Settings', Icon: SettingsIcon }
] as const;

export type DrawerLink =
	| (typeof primaryLinks)[number]
	| (typeof drawerGroups)[number]['links'][number]
	| (typeof footerLinks)[number];

// The primary destinations are Home itself or already have dedicated cards.
export const homeShortcuts = [
	...drawerGroups.flatMap<DrawerLink>((group) => group.links),
	...footerLinks
].map((link) => ({ ...link, id: `shortcut:${link.path}` }));

export const homeCardOptions = [
	{ id: HomeCardNames.ACCOUNT_GROUPS, label: 'Account Groups' },
	{ id: HomeCardNames.JOURNAL, label: 'Journal' },
	...homeShortcuts
];
