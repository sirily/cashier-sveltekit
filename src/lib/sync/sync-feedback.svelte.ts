import type { BeancountSyncDiagnostics } from './sync-beancount';

// Session-only feedback; synchronization owns writes, routes observe replacements.
export const syncFeedback = $state<{ diagnostics: BeancountSyncDiagnostics | null }>({
	diagnostics: null
});
