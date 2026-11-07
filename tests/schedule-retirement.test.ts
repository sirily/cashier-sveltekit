import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { params } from '../src/params';
import { ScheduledTransaction } from '#lib/data/model';

test('export matcher accepts only journal', async () => {
	expect(await params.exportType['~standard'].validate('journal')).toEqual({ value: 'journal' });
	for (const retired of ['scheduled', 'unsupported', 'Scheduled']) {
		expect(await params.exportType['~standard'].validate(retired)).toHaveProperty('issues');
	}
});

test('legacy storage model preserves serialized fields without adding constructor defaults', () => {
	const legacy = {
		id: 41,
		nextDate: '2099-01-15',
		period: 'months',
		count: 3,
		endDate: null,
		remarks: 'Existing legacy record',
		transaction: { note: 'Preserve stored content', postings: [] },
		legacyExtra: { keep: true }
	};
	const record = Object.assign(new ScheduledTransaction(), structuredClone(legacy));
	expect(JSON.parse(JSON.stringify(record))).toEqual(legacy);
	expect(JSON.parse(JSON.stringify(new ScheduledTransaction()))).toEqual({});
});

test('retired routes, components and recurrence module have no runtime entry points', () => {
	for (const path of [
		'src/routes/scheduled-xacts',
		'src/routes/scx-editor',
		'src/routes/scx-actions',
		'src/routes/forecast-settings',
		'src/lib/components/ScheduleEditor.svelte',
		'src/lib/components/ScheduledXactsCard.svelte',
		'src/lib/components/ForecastCard.svelte',
		'src/lib/components/DailyForecastChart.svelte',
		'src/lib/scheduledTransactions.ts'
	])
		expect(existsSync(path)).toBe(false);
	const db = readFileSync('src/lib/data/db.ts', 'utf8');
	expect(db.match(/scheduled: '\+\+id, nextDate'/g)).toHaveLength(2);
	expect(db).toContain('db.scheduled.mapToClass(ScheduledTransaction)');
});
