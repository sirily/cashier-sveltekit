<script lang="ts">
	import { resolve } from '$app/paths';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import * as BackupService from '#lib/services/backupService';
	import Notifier from '#lib/utils/notifier';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import Share2Icon from '@lucide/svelte/icons/share-2';
	import { onMount } from 'svelte';
	let _filename = $state<string>();

	Notifier.init();

	onMount(() => {
		_filename = BackupService.getBackupFilename();
	});

	async function onBackupClick() {
		await BackupService.createBackupFile(_filename as string);
	}

	async function onShareClick() {
		const output = await BackupService.createBackup();

		if (navigator.share) {
			await navigator.share({
				title: 'Cashier Backup',
				text: output
			});
		} else {
			Notifier.error('Web Share API not supported.');
		}
	}
</script>

<article>
	<Toolbar title="Backup"></Toolbar>
	<section class="p-1">
		<h3 class="text-3xl font-semibold">Create Backup</h3>

		<p>This local backup contains:</p>
		<ul class="list mx-8">
			<li>scheduled transactions</li>
			<li>settings, excluding credentials</li>
		</ul>
		<p>Journal transactions and book files are not included. Export them separately.</p>
		<p>
			Use <a href={resolve('/sync')} class="link">server Sync</a> to download your accounting book and
			reference data. Manage schedules and settings with their ordinary controls.
		</p>
		<p>Save the backup as:</p>

		<div class="flex flex-row">
			<input type="text" class="input" bind:value={_filename} readonly />
		</div>

		<center class="pt-4">
			<button type="button" class="btn btn-primary rounded" onclick={onBackupClick}>
				<FileDownIcon />
				<span>Backup</span>
			</button>
			<button type="button" class="btn btn-primary rounded" onclick={onShareClick}>
				<Share2Icon />
				<span>Share</span>
			</button>
		</center>
	</section>
</article>
