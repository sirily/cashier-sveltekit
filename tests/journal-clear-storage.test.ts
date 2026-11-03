import { afterEach, expect, test, vi } from 'vitest';
import appService from '#lib/services/appService';

const original = '2026-10-02 ! "Keep draft on failure"\n';
afterEach(() => vi.unstubAllGlobals());

for (const failure of ['directory', 'handle', 'stream', 'write', 'close', null] as const) {
	test(`empty journal is durable only after close; storage failure=${failure}`, async () => {
		let source = original;
		let pending = original;
		let close!: () => void;
		const error = new DOMException(`Denied at ${failure}`, 'NotAllowedError');
		// The old permissive OPFS helper logged and swallowed handle errors.
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const root = {
			async getFileHandle(name: string, options: { create: boolean }) {
				expect(name).toBe('cashier.bean');
				expect(options).toEqual({ create: true });
				if (failure === 'handle') throw error;
				return {
					async createWritable() {
						if (failure === 'stream') throw error;
						return {
							async write(data: Uint8Array | string) {
								if (failure === 'write') throw error;
								pending = typeof data === 'string' ? data : new TextDecoder().decode(data);
							},
							async close() {
								if (failure === 'close') throw error;
								await new Promise<void>((resolve) => {
									close = resolve;
								});
								source = pending;
							}
						};
					}
				};
			}
		};
		vi.stubGlobal('navigator', {
			storage: {
				async getDirectory() {
					if (failure === 'directory') throw error;
					return root;
				}
			}
		});
		const clearing = appService.createDefaultCashierFile();
		if (failure) {
			await expect(clearing).rejects.toThrow(`Denied at ${failure}`);
			expect(source).toBe(original);
		} else {
			let settled = false;
			void clearing.then(() => {
				settled = true;
			});
			await vi.waitFor(() => expect(close).toBeTypeOf('function'));
			expect(source).toBe(original);
			expect(settled).toBe(false);
			close();
			await clearing;
			expect(source).toBe('');
		}
	});
}
