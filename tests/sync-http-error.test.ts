import { expect, test } from 'vitest';
import { syncHttpError } from '../src/lib/sync/http-error';

for (const [status, text] of [
	[401, 'Authentication failed'],
	[403, 'Access denied'],
	[503, 'Server unavailable']
] as const) {
	test(`HTTP ${status} gives actionable secret-free feedback`, () => {
		const error = syncHttpError(status, 'Reading accounts');
		expect(error.message).toContain(text);
		expect(error.message).toContain('Reading accounts');
		expect(error.message).toContain(String(status));
	});
}
test('other HTTP errors are not diagnosed as invalid credentials', () => {
	expect(syncHttpError(500, 'Downloading book').message).not.toMatch(/token|Authentication/);
});
