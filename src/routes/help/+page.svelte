<script lang="ts">
	import Toolbar from '#lib/components/Toolbar.svelte';
	import { resolve } from '$app/paths';
</script>

<article>
	<Toolbar title="Help" />
	<section class="mx-auto max-w-4xl space-y-4 p-4">
		<h1 class="text-2xl font-bold">Using Cashier</h1>
		<p>
			Record transactions on your device, synchronize when ready, and review your finances offline.
		</p>
		<h2 class="text-xl font-semibold">Get started</h2>
		<ol class="list-decimal space-y-3 pl-6">
			<li>
				Configure your server URL and API token in <a class="link" href={resolve('/sync')}
					>Server Sync</a
				>. Run explicit Sync to download the book and reference data.
			</li>
			<li>
				Capture and edit manual transactions in <a class="link" href={resolve('/journal')}
					>Journal</a
				>, including while offline after setup. Incomplete entries remain on the device.
			</li>
			<li>
				Run Sync with “Send → pull → reconcile” to send completed entries, download the book, and
				remove only confirmed local copies. Failed or rejected entries stay local; review the stage
				explanations before retrying.
			</li>
			<li>
				Review balances, account history and <a class="link" href={resolve('/reports')}>Reports</a> over
				the downloaded book and pending entries. No network connection is needed for available local data.
			</li>
			<li>
				<a class="link" href={resolve('/export/[dataType=exportType]', { dataType: 'journal' })}
					>Journal export</a
				> is optional and leaves entries unchanged. Outbound Backup contains settings and legacy scheduled
				records, not the journal or downloaded book; it excludes the API token.
			</li>
		</ol>
		<h2 class="text-xl font-semibold">Journal and offline storage</h2>
		<p>
			Save a completed transaction with the * flag or keep an incomplete entry with !. Reopen an
			entry in Journal to correct it. Incomplete entries are not sent by Sync.
		</p>
		<p>
			Your Journal and downloaded book are stored in this browser on this device. Clearing site data
			removes these local files, including unsent entries. Export your Journal before clearing
			storage or moving to another device. Use <a class="link" href={resolve('/opfs')}
				>File Storage</a
			>
			to inspect or copy stored files; editing a source file changes the data used by local reports.
		</p>
		<h2 class="text-xl font-semibold">Sync and error recovery</h2>
		<ul class="list-disc space-y-3 pl-6">
			<li>
				If Sync cannot connect, check your network connection, server URL and API token in Server
				Sync, then retry. Do not delete local entries to resolve a connection failure.
			</li>
			<li>
				If an entry is rejected, review the Sync stage message and correct the entry in Journal
				before retrying. Completed entries stay on the device until confirmed in the downloaded
				book.
			</li>
			<li>
				If reports show incomplete data or ledger errors, open <a
					class="link"
					href={resolve('/util/validation')}>Validation</a
				> and use Reload &amp; Validate. Review the reported line and message; Inspect parsed ledger shows
				the full local analysis book and its diagnostics.
			</li>
			<li>
				If a selected book or included file is missing, check your book selection in <a
					class="link"
					href={resolve('/settings')}>Settings</a
				> and use Server Sync to download the book again. Then return to Validation and reload before
				relying on report totals.
			</li>
		</ul>
		<p>
			For application details and update checks, open <a class="link" href={resolve('/about')}
				>About</a
			>. Source and project documentation:
			<a class="link" href="https://github.com/sirily/cashier-sveltekit">Cashier repository</a>.
		</p>
	</section>
</article>
