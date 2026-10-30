import { describe, expect, test } from 'vitest';
import { ReportRequest } from '#lib/services/reportRequest.svelte';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((ok, fail) => {
		resolve = ok;
		reject = fail;
	});
	return { promise, resolve, reject };
}

describe('posting report latest-request state', () => {
	test('a new period hides the previous total and late success cannot overwrite it', async () => {
		const request = new ReportRequest<number>();
		await request.run(
			async () => 100,
			() => true
		);
		expect(request.value).toBe(100);
		const old = deferred<number>();
		const recent = deferred<number>();
		const first = request.run(
			() => old.promise,
			() => true
		);
		expect(request.value).toBeNull();
		expect(request.pending).toBe(true);
		const second = request.run(
			() => recent.promise,
			() => true
		);
		recent.resolve(20);
		await second;
		old.resolve(999);
		await first;
		expect(request.value).toBe(20);
		expect(request.pending).toBe(false);
	});

	test('late failure does not replace the current result', async () => {
		const request = new ReportRequest<number>();
		const old = deferred<number>();
		const first = request.run(
			() => old.promise,
			() => true
		);
		await request.run(
			async () => 20,
			() => true
		);
		old.reject(new Error('old query failed'));
		await first;
		expect(request.error).toBeNull();
		expect(request.value).toBe(20);
	});

	test.each(['success', 'failure'] as const)(
		'reload/unmount cancellation ignores late %s',
		async (outcome) => {
			const request = new ReportRequest<number>();
			const old = deferred<number>();
			const first = request.run(
				() => old.promise,
				() => true
			);
			request.cancel();
			if (outcome === 'success') old.resolve(100);
			else old.reject(new Error('cancelled failure'));
			await first;
			expect(request.value).toBeNull();
			expect(request.error).toBeNull();
			expect(request.pending).toBe(true);
		}
	);

	test('a changed worker version or reload flag blocks publication even before effect cleanup', async () => {
		const request = new ReportRequest<number>();
		let current = true;
		const old = deferred<number>();
		const first = request.run(
			() => old.promise,
			() => current
		);
		current = false;
		old.resolve(100);
		await first;
		expect(request.value).toBeNull();
		expect(request.pending).toBe(true);
	});

	test('current operational failures are errors, not empty results', async () => {
		const request = new ReportRequest<number>();
		await request.run(
			async () => {
				throw new Error('worker unavailable');
			},
			() => true
		);
		expect(request.value).toBeNull();
		expect(request.error).toBe('worker unavailable');
		expect(request.pending).toBe(false);
	});
});
