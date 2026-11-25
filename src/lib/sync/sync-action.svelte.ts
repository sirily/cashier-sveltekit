import Notifier from '#lib/utils/notifier';
import { synchronize } from './sync-beancount';
import { syncFeedback } from './sync-feedback.svelte';

const state = $state({ running: false, completedRuns: 0 });

export function parseSyncServerUrl(rawUrl: string): string | null {
	try {
		const url = new URL(rawUrl.trim());
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}

export const syncAction = {
	get running() {
		return state.running;
	},

	get completedRuns() {
		return state.completedRuns;
	},

	async run(prepare: () => Promise<boolean>) {
		// Both pages share the same lock, including while settings are being read or saved.
		if (state.running) return;
		state.running = true;
		try {
			if (!(await prepare())) return;

			Notifier.info('Synchronization starting...');
			const succeeded = await synchronize();
			state.completedRuns += 1;
			if (succeeded) {
				Notifier.success('Synchronization completed successfully!');
			} else {
				Notifier.error(syncFeedback.diagnostics?.lastError ?? 'Synchronization failed.');
			}
		} catch (error) {
			Notifier.error(error instanceof Error ? error.message : String(error));
		} finally {
			state.running = false;
		}
	}
};
