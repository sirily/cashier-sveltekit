import { describe, expect, test, vi } from 'vitest';
import { queryReportPostings, type ReportLedger } from '#lib/services/reportPostings';

const criteria = {
	scope: 'expenses' as const,
	dateFrom: '2026-06-01',
	dateTo: '2026-06-30',
	currency: 'USD'
};
const raw = {
	columns: ['date', 'account', 'position', 'payee', 'narration'],
	rows: [],
	errors: []
};
function client(): ReportLedger {
	return { query: vi.fn(async () => raw), getErrors: async () => [] };
}

describe('posting report failures are not successful emptiness', () => {
	test('preserves concrete BQL validation errors', async () => {
		const api = client();
		vi.mocked(api.query).mockResolvedValue({
			columns: [],
			rows: [],
			errors: [{ message: 'Invalid query expression', line: 3 }]
		});
		await expect(queryReportPostings(api, criteria)).rejects.toThrow(
			'Invalid query expression (line 3)'
		);
	});
	test('preserves operational query failures', async () => {
		const api = client();
		vi.mocked(api.query).mockRejectedValue(new Error('Worker request failed'));
		await expect(queryReportPostings(api, criteria)).rejects.toThrow('Worker request failed');
	});
	test('rejects not-ready empty columns instead of treating them as no data', async () => {
		const api = client();
		vi.mocked(api.query).mockResolvedValue({ columns: [], rows: [], errors: [] });
		await expect(queryReportPostings(api, criteria)).rejects.toThrow(
			'Unexpected report query result columns'
		);
	});
	test('does not erase missing-source/parse/validation diagnostics on empty results', async () => {
		const api = client();
		api.getErrors = async () => [{ message: 'Included file missing: selected.bean' }];
		vi.mocked(api.query)
			.mockResolvedValueOnce(raw)
			.mockResolvedValueOnce({ ...raw, columns: [...raw.columns, 'converted'] });
		await expect(queryReportPostings(api, criteria)).resolves.toEqual({
			complete: false,
			postings: [],
			issues: [],
			diagnostics: ['Included file missing: selected.bean']
		});
	});
	test.each([null, '', 'NaN', '12garbage'])(
		'invalid converted number %s never becomes zero',
		async (number) => {
			const api = client();
			const row = [
				'2026-06-10',
				'Expenses:Food',
				{ units: { number: '12', currency: 'USD' } },
				null,
				'Charge'
			];
			vi.mocked(api.query)
				.mockResolvedValueOnce({ ...raw, rows: [row] })
				.mockResolvedValueOnce({
					...raw,
					columns: [...raw.columns, 'converted'],
					rows: [[...row, { number, currency: 'USD' }]]
				});
			const result = await queryReportPostings(api, criteria);
			expect(result.complete).toBe(false);
			expect(result.postings).toEqual([]);
			expect(result.issues[0].message).toContain('original amount: 12 USD');
		}
	);
	test.each(['', 'USD")) WHERE TRUE', 'USD\n'])(
		'rejects missing/invalid configured currency %s before querying',
		async (currency) => {
			const api = client();
			await expect(queryReportPostings(api, { ...criteria, currency })).rejects.toThrow(
				'Select a valid report currency'
			);
			expect(api.query).not.toHaveBeenCalled();
		}
	);
});
