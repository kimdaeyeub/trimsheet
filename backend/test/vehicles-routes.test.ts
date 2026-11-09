import { beforeEach, describe, expect, it, vi } from 'vitest';

const started: unknown[] = [];
vi.mock('../src/shared/dispatch.ts', () => ({
	startTrimSheetJob: async (input: unknown) => void started.push(input),
	startWatcherScan: async (input: unknown) => void started.push(input),
}));

const { api } = await import('../src/routes/index.ts');
const { getRepo, resetMemorySheets } = await import('../src/sheets/index.ts');
const { resetLayoutMemo } = await import('../src/sheets/repo.ts');
const { makeEnv } = await import('./helpers/env.ts');

const call = (env: Env, path: string, init?: RequestInit) => api.request(`http://test${path}`, init, env);

beforeEach(() => {
	started.length = 0;
	resetMemorySheets();
	resetLayoutMemo();
});

describe('vehicles & scan routes', () => {
	it('starts a baseline scan first, then normal scans', async () => {
		const { env } = makeEnv();
		const first = await (await call(env, '/scan-runs', { method: 'POST' })).json();
		expect(first).toMatchObject({ mode: 'baseline' });
		await getRepo(env).setSetting('baseline_done', 'TRUE');
		const second = await (await call(env, '/scan-runs', { method: 'POST' })).json();
		expect(second).toMatchObject({ mode: 'normal' });
		const runs = (await (await call(env, '/scan-runs')).json()) as { runs: { mode: string }[]; baselineDone: boolean };
		expect(runs.baselineDone).toBe(true);
		expect(runs.runs.map((r) => r.mode).sort()).toEqual(['기준선', '일반']);
		expect(started).toHaveLength(2);
	});

	it('lets the user process a baseline vehicle and dismiss a held one', async () => {
		const { env } = makeEnv();
		const repo = getRepo(env);
		await repo.upsertVehicle({ vehicleKey: 'kia|ev3|2027', familyKey: 'kia|ev3', brand: '기아', vehicleName: 'EV3', modelYear: '2027', status: '기준선', sourceId: 'src_abc' });
		await repo.upsertVehicle({ vehicleKey: 'kia|ray|연식미상', familyKey: 'kia|ray', brand: '기아', vehicleName: 'Ray', status: '보류', reason: '연식 불명' });

		const list = (await (await call(env, '/vehicles?status=기준선')).json()) as { vehicleKey: string }[];
		expect(list.map((v) => v.vehicleKey)).toEqual(['kia|ev3|2027']);

		const res = await call(env, `/vehicles/${encodeURIComponent('kia|ev3|2027')}/process`, { method: 'POST' });
		expect(res.status).toBe(202);
		expect(started[0]).toMatchObject({ sourceId: 'src_abc' });

		expect((await call(env, `/vehicles/${encodeURIComponent('kia|ray|연식미상')}/process`, { method: 'POST' })).status).toBe(400);
		expect((await call(env, `/vehicles/${encodeURIComponent('kia|ray|연식미상')}/dismiss`, { method: 'POST' })).status).toBe(204);
		expect((await repo.listVehicles()).find((v) => v.vehicleName === 'Ray')?.reason).toContain('사용자가 무시함');
	});
});
