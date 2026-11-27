<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import Fab from '#lib/components/FAB.svelte';
	import JournalBody from '#lib/components/JournalBody.svelte';
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ToolbarMenuItem from '#lib/components/ToolbarMenuItem.svelte';
	import { Xact } from '#lib/data/model';
	import { xact, xactSpan } from '#lib/data/mainStore';
	import ledgerService from '#lib/services/ledgerService';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';
	import type { DirectiveSpan } from '#lib/rledger/sourceEditor';
	import Notifier from '#lib/utils/notifier';
	import FileDownIcon from '@lucide/svelte/icons/file-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash';
	import appService from '#lib/services/appService';

	Notifier.init();

	let isDeleteAllConfirmationOpen = $state(false);
	let isDeletingAll = $state(false);
	let journalBody = $state<{ clear(): void }>();

	function closeModal() {
		isDeleteAllConfirmationOpen = false;
	}

	async function onDeleteAllClicked() {
		isDeleteAllConfirmationOpen = true;
	}

	async function onDeleteAllConfirmed() {
		closeModal();
		if (isDeletingAll) return;
		isDeletingAll = true;
		try {
			try {
				await appService.createDefaultCashierFile();
			} catch (error) {
				Notifier.error(`Could not delete local transactions: ${String(error)}. Please try again.`);
				return;
			}

			journalBody?.clear();
			// Both owners must refresh after the durable write, even if one refresh fails.
			const refreshes = await Promise.allSettled([
				fullLedgerService.invalidate(),
				ledgerService.invalidate()
			]);
			const failures = refreshes
				.filter((result) => result.status === 'rejected')
				.map((result) => String(result.reason));
			if (failures.length) {
				Notifier.error(
					`Local transactions deleted, but refreshing views failed: ${failures.join('; ')}. Reload the app to retry analysis.`
				);
				return;
			}
			Notifier.success('All local transactions deleted.');
		} finally {
			isDeletingAll = false;
		}
	}

	async function onExportClick() {
		await goto(resolve('/export/[dataType=exportType]', { dataType: 'journal' }));
	}

	async function onFab() {
		const tx = Xact.create();
		xact.set(tx);
		xactSpan.set(undefined);
		await goto(resolve('/tx'));
	}

	async function onRowClick(tx: Xact, span: DirectiveSpan) {
		xact.set(tx);
		xactSpan.set(span);
		goto(resolve('/xact-actions'));
	}
</script>

<article class="flex h-screen flex-col">
	<Toolbar title="Journal">
		{#snippet menuItems()}
			<!-- Export -->
			<ToolbarMenuItem text="Export" Icon={FileDownIcon} onclick={onExportClick} />
			<!-- Delete All -->
			<ToolbarMenuItem text="Delete All" onclick={onDeleteAllClicked} Icon={TrashIcon} />
		{/snippet}
	</Toolbar>

	<JournalBody recent={false} onselect={onRowClick} bind:this={journalBody} />

	<Fab onclick={onFab} Icon={PlusIcon} />
</article>

<!-- "Delete All" dialog -->
<input
	type="checkbox"
	id="delete-all-journal-confirmation-modal"
	class="modal-toggle"
	bind:checked={isDeleteAllConfirmationOpen}
/>
<dialog class="modal">
	<div class="modal-box">
		<header class="flex justify-between">
			<h2 class="text-lg font-bold">Confirm Delete</h2>
		</header>
		<article>
			<p class="py-4 opacity-60">Do you want to delete all transactions?</p>
		</article>
		<footer class="flex justify-end gap-4">
			<button type="button" class="btn btn-ghost" onclick={closeModal}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary text-primary-content"
				onclick={onDeleteAllConfirmed}>OK</button
			>
		</footer>
	</div>
</dialog>
