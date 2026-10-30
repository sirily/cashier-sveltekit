<script lang="ts">
	import { resolve } from '$app/paths';
	// Stylesheets
	import '../app.css';
	// libs
	import { useSwipe, type SwipeCustomEvent } from 'svelte-gestures';
	// import Navigation from '#lib/components/navigation.svelte';
	// PWA

	import { onMount } from 'svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import { drawerState } from '#lib/data/mainStore';
	import NavigationV3 from '#lib/components/navigation.svelte';
	import Notifier from '#lib/utils/notifier';
	import ReloadPrompt from '#lib/components/ReloadPrompt.svelte';
	import { ensureInitialized } from '#lib/data/initializer';

	let { children } = $props();

	onMount(async () => {
		void import('#lib/services/pwaUpdate.svelte')
			.then(({ initPwa }) => initPwa())
			.catch((error) => console.error('PWA initialization failed:', error));

		// Initialize the Ledger service.
		const initialized = await initializeApp();
		if (!initialized) {
			Notifier.error('Failed to initialize the engine.');
			return;
		}
	});

	async function initializeApp(): Promise<boolean> {
		// Check if the main ledger file exists?
		await ensureInitialized();

		try {
			await fullLedgerService.ensureLoaded();
			console.log('FullLedgerService loaded and ready');
			return true;
		} catch (err) {
			console.error('Failed to initialize FullLedgerService:', err);
			Notifier.error('Failed to initialize the engine.' + err);
			return false;
		}
	}

	function handleSwipe(e: SwipeCustomEvent) {
		if (e.detail.direction == 'right') {
			drawerState.update((state) => true);
		}
		if (e.detail.direction == 'left') {
			drawerState.update((state) => false);
		}
	}

	function handleDrawerSideSwipe(e: SwipeCustomEvent) {
		if (e.detail.direction == 'left') {
			drawerState.update((state) => false);
		}
	}
</script>

<svelte:head>
	<title>Cashier</title>

	<!-- PWA -->
	<base href={resolve("/")} />
</svelte:head>

<div class="drawer">
	<!-- sidebar as modal -->
	<input type="checkbox" id="drawer-modal" class="drawer-toggle" bind:checked={$drawerState} />
	<div class="drawer-content h-screen">
		<!-- former AppShell -->
		<div class="grid grid-cols-1 lg:grid-cols-[288px_1fr] h-screen">
			<aside class="sticky top-0 col-span-1 hidden h-screen overflow-y-auto lg:block">
				<!-- <Navigation /> -->
				<NavigationV3 />
			</aside>

			<main class="col-span-1 bg-base-300 h-full overflow-auto touch-pan-y"
				{...useSwipe(handleSwipe, () => ({
					timeframe: 350,
					minSwipeDistance: 25,
					touchAction: 'pan-y'
				}))}>
				{@render children()}
			</main>
		</div>
	</div>
	<div class="drawer-side"
		{...useSwipe(handleDrawerSideSwipe, () => ({
			timeframe: 350,
			minSwipeDistance: 25,
			touchAction: 'pan-y'
		}))}>
		<label for="drawer-modal" class="drawer-overlay"></label>
		<div class="bg-base-200 w-[288px] h-screen overflow-y-auto">
			<!-- <Navigation /> -->
			<NavigationV3 />
		</div>
	</div>
</div>

<ReloadPrompt />
