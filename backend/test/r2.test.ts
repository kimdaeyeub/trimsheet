import { describe, expect, it } from 'vitest';
import type { JobState } from '@shared/types';
import { acquireVehicleLock, putPdf, readState, releaseVehicleLock, writeState } from '../src/store/r2.ts';
import { FakeR2, asBucket } from './helpers/fake-r2.ts';

const state = (jobId: string): JobState => ({
	jobId,
	conversationId: null,
	sourceId: 'src_x',
	stage: 'created',
	outcome: null,
	progressNote: '',
	pageCount: null,
	pageMap: null,
	isScanned: null,
	vehicle: null,
	dedup: null,
	force: false,
	sha256: 'abc',
	filename: 'a.pdf',
	sourceUrl: null,
	lockedVehicleKey: null,
	models: {},
	fallbackReasons: [],
	counts: null,
	error: null,
	createdAt: '2026-11-09T00:00:00.000Z',
	updatedAt: '2026-11-09T00:00:00.000Z',
});

describe('R2 store', () => {
	it('stores a PDF once per content hash', async () => {
		const b = asBucket(new FakeR2());
		expect(await putPdf(b, 'abc', new ArrayBuffer(4), { filename: '가격표.pdf', origin: 'upload' })).toBe(true);
		expect(await putPdf(b, 'abc', new ArrayBuffer(4), { filename: '가격표.pdf', origin: 'upload' })).toBe(false);
	});

	it('creates job state once and rejects stale overwrites', async () => {
		const b = asBucket(new FakeR2());
		const etag1 = await writeState(b, state('job_1'));
		expect(etag1).toBeTruthy();
		expect(await writeState(b, state('job_1'))).toBeNull(); // create-only

		const etag2 = await writeState(b, { ...state('job_1'), stage: 'prepared' }, etag1!);
		expect(etag2).toBeTruthy();
		expect(await writeState(b, { ...state('job_1'), stage: 'failed' }, etag1!)).toBeNull(); // stale etag
		expect((await readState(b, 'job_1'))?.value.stage).toBe('prepared');
	});

	it('locks a vehicle, refuses a second holder, and expires stale locks', async () => {
		const b = asBucket(new FakeR2());
		const t0 = new Date('2026-11-09T00:00:00Z');
		expect(await acquireVehicleLock(b, 'genesis|g80|2026', 'job_a', 30, t0)).toEqual({ acquired: true });
		expect(await acquireVehicleLock(b, 'genesis|g80|2026', 'job_b', 30, new Date(t0.getTime() + 60_000))).toEqual({
			acquired: false,
			heldBy: 'job_a',
		});
		expect(await acquireVehicleLock(b, 'genesis|g80|2026', 'job_b', 30, new Date(t0.getTime() + 31 * 60_000))).toEqual({
			acquired: true,
		});
		await releaseVehicleLock(b, 'genesis|g80|2026', 'job_a'); // not the holder → no-op
		expect(await acquireVehicleLock(b, 'genesis|g80|2026', 'job_c', 30, new Date(t0.getTime() + 32 * 60_000))).toMatchObject({
			acquired: false,
		});
		await releaseVehicleLock(b, 'genesis|g80|2026', 'job_b');
		expect(await acquireVehicleLock(b, 'genesis|g80|2026', 'job_c', 30, t0)).toEqual({ acquired: true });
	});
});
