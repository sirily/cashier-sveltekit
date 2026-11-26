// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, expect, test, vi } from 'vitest';
import HomeSectionCards from '#lib/components/HomeSectionCards.svelte';

const mocks = vi.hoisted(() => ({ createBackupFile: vi.fn(), createBackup: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));
vi.mock('#lib/services/backupService', () => ({
	getBackupFilename: () => 'cashier-backup_local.json',
	createBackupFile: mocks.createBackupFile,
	createBackup: mocks.createBackup
}));
afterEach(() => {
	cleanup();
	Reflect.deleteProperty(navigator, 'share');
});

test('Home prepares no backup until the user explicitly downloads or shares', async () => {
	const share = vi.fn().mockResolvedValue(undefined);
	Object.defineProperty(navigator, 'share', { configurable: true, value: share });
	const data = '{"settings":[],"scx":[]}';
	mocks.createBackup.mockResolvedValue(data);
	mocks.createBackupFile.mockResolvedValue(undefined);
	const view = render(HomeSectionCards, { cards: ['shortcut:/backup'] });
	const filename = await view.findByRole('textbox', { name: 'Backup filename' });
	expect(filename).toHaveProperty('value', 'cashier-backup_local.json');
	expect(mocks.createBackupFile).not.toHaveBeenCalled();
	expect(mocks.createBackup).not.toHaveBeenCalled();
	expect(share).not.toHaveBeenCalled();
	await fireEvent.click(view.getByRole('button', { name: /^Backup$/ }));
	expect(mocks.createBackupFile).toHaveBeenCalledExactlyOnceWith('cashier-backup_local.json');
	await fireEvent.click(view.getByRole('button', { name: 'Share' }));
	await waitFor(() =>
		expect(share).toHaveBeenCalledExactlyOnceWith({ title: 'Cashier Backup', text: data })
	);
});
