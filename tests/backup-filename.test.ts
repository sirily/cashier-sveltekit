import { afterEach, expect, test, vi } from 'vitest';
import { getFilenameForBackup } from '#lib/services/backupFilename';

afterEach(() => vi.useRealTimers());

test('retained filename helper preserves journal and scheduled download names', () => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 10, 2, 12, 34, 56));
	expect(getFilenameForBackup('journal')).toBe('journal_2026-11-02_123456.ledger');
	expect(getFilenameForBackup('scheduled')).toBe('scheduled_2026-11-02_123456.json');
});
