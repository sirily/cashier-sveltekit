<script lang="ts">
	import { drawerState } from '#lib/data/mainStore';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	// Icons
	import {
		CalendarClockIcon,
		ChartLineIcon,
		ChartPieIcon,
		DatabaseIcon,
		WrenchIcon,
		CircleQuestionMarkIcon,
		HouseIcon,
		InfoIcon,
		LandmarkIcon,
		ScrollIcon,
		SettingsIcon,
		StarIcon,
		UsersRoundIcon,
		ContainerIcon,
		FolderOpenIcon,
		FolderInputIcon,
		ArrowLeftRightIcon,
		ChartNoAxesCombinedIcon,
		HardDriveIcon,
		CalculatorIcon,
		CalendarIcon,
		MicIcon,
		ListTreeIcon,
		ShieldCheckIcon,
		CloudUploadIcon
	} from '@lucide/svelte';

	function closeDrawer(): void {
		// the new drawer
		drawerState.update((state) => false);
	}
</script>

<div class="bg-base-200 flex h-screen flex-col">
	<div class="bg-primary w-full p-4">
		<div class="flex w-full items-center justify-center">
			<img src="/icons/icon-192.png" class="w-1/3 lg:w-1/2" alt="logo" />
		</div>
		<div class="pt-2 text-center">
			<p class="text-2xl font-semibold">Cashier</p>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto">
		<ul class="menu menu-lg w-full">
			<li>
				<a
					href={resolve('/')}
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<HouseIcon />
					<span>Home</span>
				</a>
			</li>
			<li>
				<a
					href={resolve('/accounts/groups')}
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/accounts/groups'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<LandmarkIcon />
					<span>My Accounts</span>
				</a>
			</li>
			<li>
				<a
					href={resolve('/journal')}
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/journal'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<ScrollIcon />
					<span>Journal</span>
				</a>
			</li>
			<li>
				<a
					href={resolve('/scheduled-xacts')}
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/scheduled-xacts'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<CalendarClockIcon />
					<span>Scheduled Transactions</span>
				</a>
			</li>
			<li>
				<a
					href={resolve('/tools/voice-entry')}
					class="flex w-full items-center gap-2 py-2"
					onclick={closeDrawer}
				>
					<MicIcon />
					<span>Voice Entry</span>
				</a>
			</li>
		</ul>

		<div class="divider divider-primary m-1"></div>

		<ul class="menu menu-lg w-full">
			<li>
				<details>
					<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
						<ChartNoAxesCombinedIcon size={22} />
						<span>Analysis</span>
						<span class="flex-1"></span>
					</summary>
					<ul>
						<li>
							<a
								href={resolve('/reports')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/reports'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ChartLineIcon />
								<span>Reports</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/accounts/tree')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/accounts/tree'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ListTreeIcon />
								<span>Account Tree</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/favourites')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/favourites'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<StarIcon />
								<span>Favourites</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/scheduled-xacts/calendar')}
								class="flex w-full items-center gap-2 py-2"
								onclick={closeDrawer}
							>
								<CalendarIcon />
								<span>Calendar</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/accounts')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/accounts'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<LandmarkIcon />
								<span>Accounts</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/asset-allocation')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/asset-allocation'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ChartPieIcon />
								<span>Asset Allocation</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/payees')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/payees'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<UsersRoundIcon />
								<span>Payees</span>
							</a>
						</li>
					</ul>
				</details>
			</li>
			<li>
				<details>
					<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
						<HardDriveIcon size={22} />
						<span>Data</span>
						<span class="flex-1"></span>
					</summary>
					<ul>
						<li>
							<a
								href={resolve('/opfs/import-ledger')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/opfs/import-ledger'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<FolderInputIcon />
								<span>Ledger Import</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/opfs/sync')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/opfs/sync'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ArrowLeftRightIcon />
								<span>Sync</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/backup')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/backup'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<DatabaseIcon />
								<span>Backup</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/backup/webdav')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/backup/webdav'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<CloudUploadIcon />
								<span>WebDAV Backup</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/opfs')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/opfs'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<FolderOpenIcon />
								<span>File Storage</span>
							</a>
						</li>
					</ul>
				</details>
			</li>
			<li>
				<details>
					<summary class="flex w-full items-center gap-2 py-2 text-lg font-medium">
						<WrenchIcon size={22} />
						<span>Utilities</span>
						<span class="flex-1"></span>
					</summary>
					<ul>
						<li>
							<a
								href={resolve('/tools/serialization')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname ===
								'/tools/serialization'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ContainerIcon />
								<span>Serialization</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/calculator')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/calculator'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<CalculatorIcon />
								<span>Calculator</span>
							</a>
						</li>
						<li>
							<a
								href={resolve('/util/validation')}
								class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/util/validation'
									? 'active bg-secondary text-secondary-content'
									: ''}"
								onclick={closeDrawer}
							>
								<ShieldCheckIcon />
								<span>Validation</span>
							</a>
						</li>
					</ul>
				</details>
			</li>
			<!-- <li>
				<a
					href="/demo/peer-sync"
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/peer-sync'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<RefreshCw />
					<span>Peer Sync</span>
				</a>
			</li> -->
		</ul>

		<div class="divider divider-primary m-1"></div>

		<ul class="menu menu-lg w-full">
			<li>
				<a
					href={resolve('/help')}
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/help'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<CircleQuestionMarkIcon />
					<span>Help</span>
				</a>
			</li>
			<li>
				<a
					href={resolve('/about')}
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/about'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<InfoIcon />
					<span>About</span>
				</a>
			</li>
			<li>
				<a
					href={resolve('/settings')}
					class="flex w-full items-center gap-2 py-2 {page.url.pathname === '/settings'
						? 'active bg-secondary text-secondary-content'
						: ''}"
					onclick={closeDrawer}
				>
					<SettingsIcon />
					<span>Settings</span>
				</a>
			</li>
		</ul>
	</div>
</div>
