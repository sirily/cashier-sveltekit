import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { WorkerRequest, WorkerResponsePayload } from '#lib/workers/ledger.worker';

const state = vi.hoisted(() => ({ get: vi.fn(), workers: [] as any[] }));
vi.mock('#lib/settings', () => ({
	settings: { get: state.get },
	SettingKeys: { ledgerCacheEnabled: 'ledgerCacheEnabled' }
}));

class TestWorker {
	onmessage?: (event: { data: unknown }) => void;
	onerror?: (event: { message: string }) => void;
	requests: WorkerRequest[] = [];
	constructor() {
		state.workers.push(this);
	}
	postMessage(request: WorkerRequest) {
		this.requests.push(request);
	}
	reply(type: WorkerRequest['type'], payload: WorkerResponsePayload) {
		const request = this.requests.find((request) => request.type === type);
		if (!request) throw new Error(`No ${type} request`);
		this.requests.splice(this.requests.indexOf(request), 1);
		this.onmessage?.({ data: { id: request.id, ...payload } });
	}
}
const loaded = { type: 'load-done', directiveCount: 4, errorCount: 0, ms: 1 } as const;
const result: Extract<WorkerResponsePayload, { type: 'query-done' }> = {
	type: 'query-done',
	columns: ['number'],
	rows: [['1455']],
	errors: []
};

async function client() {
	return (await import('#lib/services/ledgerWorkerClient')).default;
}
async function worker() {
	await vi.waitFor(() => expect(state.workers).toHaveLength(1));
	return state.workers[0] as TestWorker;
}
async function request(worker: TestWorker, type: WorkerRequest['type']) {
	await vi.waitFor(() => expect(worker.requests.some((r) => r.type === type)).toBe(true));
}

beforeEach(() => {
	vi.resetModules();
	state.workers.length = 0;
	state.get.mockReset().mockResolvedValue(undefined);
	vi.stubGlobal('Worker', TestWorker);
});

describe('full-book readiness', () => {
	it('a cold query waits for the shared local load rather than succeeding with empty rows', async () => {
		const service = await client();
		let settled = false;
		const query = service.query('SELECT number').finally(() => {
			settled = true;
		});
		const loading = service.ensureLoaded();
		const w = await worker();
		await request(w, 'ensure-loaded');
		expect(settled).toBe(false);
		expect(w.requests.filter((r) => r.type === 'ensure-loaded')).toHaveLength(1);
		w.reply('ensure-loaded', loaded);
		await request(w, 'query');
		w.reply('query', result);
		await expect(query).resolves.toEqual({ columns: ['number'], rows: [['1455']], errors: [] });
		await loading;
	});

	it.each([true, false])('honors ledger caching = %s on a cold load', async (enabled) => {
		state.get.mockImplementation(async (key) =>
			key === 'ledgerCacheEnabled' ? enabled : 'main.bean'
		);
		const service = await client();
		const loading = service.ensureLoaded();
		const w = await worker();
		await request(w, 'ensure-loaded');
		expect(w.requests[0]).toMatchObject({ useCaching: enabled, userBookFilename: 'main.bean' });
		w.reply('ensure-loaded', loaded);
		await loading;
	});

	it('waits for invalidate and queries the new composition', async () => {
		const service = await client();
		const initial = service.ensureLoaded();
		const w = await worker();
		await request(w, 'ensure-loaded');
		w.reply('ensure-loaded', loaded);
		await initial;
		const refresh = service.invalidate();
		const query = service.query('SELECT number');
		await request(w, 'invalidate');
		expect(w.requests.some((r) => r.type === 'query')).toBe(false);
		w.reply('invalidate', loaded);
		await refresh;
		await request(w, 'query');
		w.reply('query', result);
		await expect(query).resolves.toHaveProperty('rows', [['1455']]);
	});

	it('does not finalize an old in-flight result after invalidation starts', async () => {
		const service = await client();
		const initial = service.ensureLoaded();
		const w = await worker();
		await request(w, 'ensure-loaded');
		w.reply('ensure-loaded', loaded);
		await initial;
		let settled = false;
		const query = service.query('SELECT number').finally(() => {
			settled = true;
		});
		await request(w, 'query');
		const refresh = service.invalidate();
		await request(w, 'invalidate');
		w.reply('query', { ...result, rows: [['old']] });
		await Promise.resolve();
		expect(settled).toBe(false);
		w.reply('invalidate', loaded);
		await refresh;
		await request(w, 'query');
		w.reply('query', result);
		await expect(query).resolves.toHaveProperty('rows', [['1455']]);
	});

	it('an unavailable load does not retrigger version subscribers or duplicate concurrent loads', async () => {
		const service = await client();
		const version = get(service.version);
		const first = service.ensureLoaded();
		const second = service.ensureLoaded();
		const w = await worker();
		await request(w, 'ensure-loaded');
		w.reply('ensure-loaded', { type: 'error', message: 'No .bean files found in OPFS' });
		await Promise.all([first, second]);
		expect(get(service.version)).toBe(version);
		expect(w.requests).toEqual([]);
	});

	it('follows a newer refresh when the load it was waiting for fails', async () => {
		const service = await client();
		const query = service.query('SELECT number');
		const w = await worker();
		await request(w, 'ensure-loaded');
		const refresh = service.invalidate();
		w.reply('ensure-loaded', { type: 'error', message: 'Old source read failed' });
		await request(w, 'invalidate');
		w.reply('invalidate', loaded);
		await refresh;
		await request(w, 'query');
		w.reply('query', result);
		await expect(query).resolves.toHaveProperty('rows', [['1455']]);
	});

	it('distinguishes an unconfigured book and load failure from successful zero rows', async () => {
		const service = await client();
		const unavailable = service.query('SELECT number');
		const unavailableCheck = expect(unavailable).rejects.toThrow(
			/unavailable|not.*loaded|No .bean/i
		);
		const w = await worker();
		await request(w, 'ensure-loaded');
		w.reply('ensure-loaded', { type: 'error', message: 'No .bean files found in OPFS' });
		await unavailableCheck;
		expect(get(service.isConfigured)).toBe(false);

		const failure = service.query('SELECT number');
		const failureCheck = expect(failure).rejects.toThrow('OPFS denied');
		await request(w, 'ensure-loaded');
		w.reply('ensure-loaded', { type: 'error', message: 'OPFS denied' });
		await failureCheck;

		const empty = service.query('SELECT number');
		await request(w, 'ensure-loaded');
		w.reply('ensure-loaded', loaded);
		await request(w, 'query');
		w.reply('query', { ...result, rows: [] });
		await expect(empty).resolves.toEqual({ columns: ['number'], rows: [], errors: [] });
	});
});
