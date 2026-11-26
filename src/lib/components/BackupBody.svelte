<script lang="ts">
	import { resolve } from '$app/paths';
	import * as BackupService from '#lib/services/backupService';
	import Notifier from '#lib/utils/notifier';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import Share2Icon from '@lucide/svelte/icons/share-2';

	const filename = BackupService.getBackupFilename();

	async function onBackupClick() {
		try {
			await BackupService.createBackupFile(filename);
		} catch (error) {
			Notifier.error('Could not download the backup: ' + String(error));
		}
	}

	async function onShareClick() {
		if (!navigator.share) {
			Notifier.error('Web Share API not supported.');
			return;
		}
		try {
			await navigator.share({ title: 'Cashier Backup', text: await BackupService.createBackup() });
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) {
				Notifier.error('Could not share the backup: ' + String(error));
			}
		}
	}
</script>

<section class="space-y-2 p-2">
	<h3 class="text-3xl font-semibold">Create Backup</h3>

	<p>This local backup contains:</p>
	<ul class="list mx-8">
		<li>legacy scheduled records stored on this device</li>
		<li>settings, excluding credentials</li>
	</ul>
	<p>Export journal transactions and book files separately.</p>
	<p>
		Use <a href={resolve('/sync')} class="link">server Sync</a> to download your accounting book and reference
		data. Configure the app through Settings.
	</p>
	<p>Save the backup as:</p>

	<input
		type="text"
		class="input w-full max-w-sm"
		aria-label="Backup filename"
		value={filename}
		readonly
	/>

	<div class="flex flex-wrap justify-center gap-2 pt-4">
		<button type="button" class="btn btn-primary rounded" onclick={onBackupClick}>
			<FileDownIcon />
			<span>Backup</span>
		</button>
		<button type="button" class="btn btn-primary rounded" onclick={onShareClick}>
			<Share2Icon />
			<span>Share</span>
		</button>
	</div>
</section>
