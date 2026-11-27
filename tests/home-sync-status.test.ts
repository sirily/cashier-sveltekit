// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';
import { syncAction } from '#lib/sync/sync-action.svelte';
import { syncFeedback } from '#lib/sync/sync-feedback.svelte';
import { initializeSyncProgress, updateSyncStep } from '#lib/stores/syncProgressStore';

const secret = 'only-a-test-token';
const mocks = vi.hoisted(() => ({ synchronize: vi.fn(), save: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/settings')>()),
	settings: {
		get: async (key: string) => (key === 'syncApiToken' ? secret : 'https://cashier.test/api'),
		set: mocks.save
	}
}));
vi.mock('#lib/sync/sync-beancount', () => ({ synchronize: mocks.synchronize }));
vi.mock('#lib/utils/notifier', () => ({
	default: { info: vi.fn(), error: vi.fn(), success: vi.fn() }
}));

afterEach(() => {
	cleanup();
	syncFeedback.diagnostics = null;
});

test('the Home Sync card only reads configuration and observes progress from the shared guarded action', async () => {
	const result = Promise.withResolvers<boolean>();
	mocks.synchronize.mockImplementationOnce(async () => {
		initializeSyncProgress();
		syncFeedback.diagnostics = { syncErrors: [] };
		updateSyncStep(6, 'in-progress');
		return result.promise;
	});
	const view = render(HomeSectionCards, { cards: ['shortcut:/sync'] });
	await view.findByText('Server connection is configured.');
	expect(view.getByText('No synchronization results yet.')).toBeDefined();
	expect(view.queryByRole('button', { name: 'Synchronize' })).toBeNull();
	expect(mocks.synchronize).not.toHaveBeenCalled();
	expect(mocks.save).not.toHaveBeenCalled();

	const firstRun = syncAction.run(async () => true);
	try {
		await view.findByText('Synchronization in progress…');
		await view.findByText('In progress');
		const duplicate = vi.fn(async () => true);
		await syncAction.run(duplicate);
		expect(duplicate).not.toHaveBeenCalled();
		expect(mocks.synchronize).toHaveBeenCalledOnce();
	} finally {
		// The producer sanitizes retained diagnostics before the card can render them.
		const message = 'Download failed, echoed value: [redacted]';
		updateSyncStep(6, 'error');
		syncFeedback.diagnostics = { lastError: message, syncErrors: [{ stage: 'pull', message }] };
		result.resolve(false);
		await firstRun;
	}

	const alert = await view.findByRole('alert');
	expect(alert.textContent).toContain('pull:');
	expect(alert.textContent).toContain('Download failed, echoed value: [redacted]');
	expect(view.container.textContent).not.toContain(secret);
	await waitFor(() => expect(view.queryByText('Synchronization in progress…')).toBeNull());
});
