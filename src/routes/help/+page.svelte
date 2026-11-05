<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { resolve } from '$app/paths';
</script>

<article>
	<Toolbar title="Help" />
	<section class="space-y-4 p-4">
		<h1 class="text-2xl font-bold">Using the Cashier fork</h1>
		<p>This fork uses an authoritative Python Beancount server and an offline device Journal.</p>
		<ol class="list-decimal space-y-3 pl-6">
			<li>Configure your server URL and API token in <a class="link" href={resolve('/sync')}>Server Sync</a>. Run explicit Sync to download the book and reference data.</li>
			<li>Capture and edit manual transactions in <a class="link" href={resolve('/journal')}>Journal</a>, including while offline after setup. Incomplete entries remain on the device.</li>
			<li>Run Sync with “Send → pull → reconcile” to send completed entries, download the book, and remove only confirmed local copies. Failed or rejected entries stay local; review the stage explanations before retrying.</li>
			<li>Balances, account history and reports use local RustLedger calculations over the downloaded book and pending entries. No network connection is needed for available local data.</li>
			<li><a class="link" href={resolve('/export/[dataType=exportType]', { dataType: 'journal' })}>Journal export</a> is optional and leaves entries unchanged. Outbound Backup contains settings and legacy scheduled records, not the journal or downloaded book; it excludes the API token.</li>
		</ol>
		<p>Source and current project documentation: <a class="link" href="https://github.com/sirily/cashier-sveltekit">Cashier fork repository</a>.</p>
	</section>
</article>
