<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import ValidationBody from '#lib/components/ValidationBody.svelte';
	import fullLedgerService from '#lib/services/ledgerWorkerClient';

	let reloading = $state(false);
	let reloadError = $state('');

	async function reload() {
		if (reloading) return;
		reloading = true;
		reloadError = '';
		try {
			await fullLedgerService.invalidate();
		} catch (error) {
			reloadError = error instanceof Error ? error.message : String(error);
		} finally {
			reloading = false;
		}
	}
</script>

<Toolbar title="Ledger Validation" />
<ValidationBody onreload={reload} {reloading} {reloadError} />
