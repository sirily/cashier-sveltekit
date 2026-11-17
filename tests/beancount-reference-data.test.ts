import { expect, test, vi } from 'vitest';
import { getQueries } from '#lib/sync/sync-queries';

test('local security analysis retains its BQL helpers without network access', () => {
	const network = vi.fn(() => {
		throw new Error('Local queries must not use HTTP');
	});
	vi.stubGlobal('fetch', network);
	try {
		const queries = getQueries();
		expect(queries.incomeBalance('LONGCOIN', '2025-11-03', 'GBP')).toContain(
			"WHERE account ~ '^Income.*:LONGCOIN$'"
		);
		expect(queries.incomeBalance('LONGCOIN', '2025-11-03', 'GBP')).toContain(
			'AND date >= 2025-11-03'
		);
		expect(queries.valueBalance('LONGCOIN', 'GBP')).toContain("str(convert(sum(position), 'GBP'))");
		expect(queries.gainLoss('LONGCOIN', 'GBP')).toContain(
			"str(convert(value(sum(position)), 'GBP')) AS market_value"
		);
		expect(network).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
	}
});
