<script lang="ts">
	import { resolve } from '$app/paths';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import OpfsFilePicker from '#lib/components/OpfsFilePicker.svelte';
	import FilePlusIcon from '@lucide/svelte/icons/file-plus';

	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	import { goto } from '$app/navigation';
	import * as OpfsLib from '#lib/utils/opfslib.js';
	import type { FileTreeEntry } from '#lib/utils/opfslib.js';
	import Notifier from '#lib/utils/notifier';

	Notifier.init();

	let filePicker = $state<ReturnType<typeof OpfsFilePicker> | null>(null);
	let selectedFile = $state<string | null>(null);
	let showNewFileDialog = $state(false);
	let newFileName = $state('');
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);
	let fileToDelete = $state<string | null>(null);

	let showDeleteAllConfirm = $state(false);
	let isDeletingAll = $state(false);

	function onFileSelect(entry: FileTreeEntry) {
		goto(resolve(`/opfs/edit-file?${new URLSearchParams({ file: entry.path })}`));
	}

	function confirmDelete(filePath: string) {
		fileToDelete = filePath;
		showDeleteConfirm = true;
	}

	async function deleteFile() {
		if (!fileToDelete) return;

		isDeleting = true;
		try {
			const success = await OpfsLib.deleteFile(fileToDelete);

			if (success) {
				Notifier.success(`File deleted successfully`);
			} else {
				Notifier.error(`Failed to delete file`);
			}

			showDeleteConfirm = false;

			if (selectedFile === fileToDelete) {
				selectedFile = null;
			}

			fileToDelete = null;
			await filePicker?.refresh();
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to delete file');
		} finally {
			isDeleting = false;
		}
	}

	async function createNewFile() {
		if (!newFileName.trim()) {
			Notifier.error('Please enter a filename');
			return;
		}

		try {
			await OpfsLib.saveFile(newFileName.trim(), '');
			Notifier.success(`File "${newFileName}" created successfully`);
			newFileName = '';
			showNewFileDialog = false;
			await filePicker?.refresh();
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to create file');
		}
	}

	function openNewFileDialog() {
		showNewFileDialog = true;
		newFileName = '';
	}

	function closeNewFileDialog() {
		showNewFileDialog = false;
		newFileName = '';
	}

	async function deleteAll() {
		isDeletingAll = true;
		try {
			await OpfsLib.deleteAll();
			selectedFile = null;
			showDeleteAllConfirm = false;
			Notifier.success('All files deleted');
			await filePicker?.refresh();
		} catch (error: any) {
			Notifier.error(error.message || 'Failed to delete all files');
		} finally {
			isDeletingAll = false;
		}
	}
</script>

<article class="h-screen flex flex-col overflow-hidden">
	<Toolbar title="OPFS Files">
		{#snippet menuItems()}
			<li>
				<button class="btn btn-sm btn-ghost gap-2" onclick={openNewFileDialog}>
					<FilePlusIcon class="w-5 h-5" />
					<span>New File</span>
				</button>
			</li>

			<li>
				<button
					class="btn btn-sm btn-ghost gap-2 text-error"
					onclick={() => (showDeleteAllConfirm = true)}
				>
					<Trash2Icon class="w-5 h-5" />
					<span>Delete All</span>
				</button>
			</li>
		{/snippet}
	</Toolbar>

	<section class="flex-1 overflow-hidden p-4">
		<div class="overflow-x-auto overflow-y-auto h-full">
			<OpfsFilePicker
				bind:this={filePicker}
				bind:selectedFile
				showDeleteButtons
				onfileselect={onFileSelect}
				ondeleteclick={confirmDelete}
			/>
		</div>
	</section>

	<!-- Delete Confirmation Modal -->
	{#if showDeleteConfirm}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Confirm Deletion</h3>
				<p>Are you sure you want to delete "{fileToDelete}"?</p>
				<div class="modal-action">
					<button class="btn" onclick={() => (showDeleteConfirm = false)} disabled={isDeleting}
						>Cancel</button
					>
					<button class="btn btn-error" onclick={deleteFile} disabled={isDeleting}>
						{isDeleting ? 'Deleting...' : 'Delete'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- New File Dialog Modal -->
	{#if showNewFileDialog}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Create New Text File</h3>
				<div class="form-control">
					<label for="newFileNameInput" class="label">
						<span class="label-text">Filename</span>
					</label>
					<input
						id="newFileNameInput"
						type="text"
						class="input input-bordered w-full"
						placeholder="Enter filename..."
						bind:value={newFileName}
						onkeydown={(e) => {
							if (e.key === 'Enter') createNewFile();
						}}
					/>
				</div>
				<div class="modal-action">
					<button class="btn" onclick={closeNewFileDialog}>Cancel</button>
					<button class="btn btn-primary" onclick={createNewFile}>Create</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Delete All Confirmation Modal -->
	{#if showDeleteAllConfirm}
		<div class="modal modal-open">
			<div class="modal-box">
				<h3 class="font-bold text-lg">Delete All Files</h3>
				<p>This will permanently delete all files and folders from OPFS. This cannot be undone.</p>
				<div class="modal-action">
					<button
						class="btn"
						onclick={() => (showDeleteAllConfirm = false)}
						disabled={isDeletingAll}>Cancel</button
					>
					<button class="btn btn-error" onclick={deleteAll} disabled={isDeletingAll}>
						{isDeletingAll ? 'Deleting...' : 'Delete All'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</article>
