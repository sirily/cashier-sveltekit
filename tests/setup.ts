import { afterEach, beforeEach, vi } from 'vitest';

let unexpectedConsoleCalls: Array<{ method: 'warn' | 'error'; args: unknown[] }>;

let originalConsoleMethods: Partial<Record<'warn' | 'error', (...args: unknown[]) => void>>;

beforeEach(() => {
	unexpectedConsoleCalls = [];
	originalConsoleMethods = {};
	for (const method of ['warn', 'error'] as const) {
		const original = console[method];
		originalConsoleMethods[method] = original;
		console[method] = (...args: unknown[]) => {
			unexpectedConsoleCalls.push({ method, args });
			original.apply(console, args);
		};
	}
});

afterEach(() => {
	const calls = unexpectedConsoleCalls;
	vi.restoreAllMocks();
	for (const method of ['warn', 'error'] as const) {
		const original = originalConsoleMethods[method];
		if (original) console[method] = original;
	}
	if (calls.length > 0) {
		throw new Error(
			`Unexpected console call(s): ${calls.map(({ method, args }) => `console.${method}(${args.map(String).join(', ')})`).join('; ')}`
		);
	}
});
