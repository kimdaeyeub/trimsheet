import { describe, expect, it } from 'vitest';
import { applyScanCap, decide, keepLatestPerFamily, type Candidate, type DedupPolicy, type RegisteredVehicle } from '../src/pipeline/dedup.ts';

const policy: DedupPolicy = { maxPriceSheetAgeDays: 400, sameYearNewerPriceSheet: 'process' };
const now = new Date('2026-11-09T00:00:00Z');

const reg = (year: string, over: Partial<RegisteredVehicle> = {}): RegisteredVehicle => ({
	vehicleKey: `genesis|g80|${year}`,
	familyKey: 'genesis|g80',
	modelYear: year,
	effectiveDate: '2026-10-01',
	status: '처리 완료',
	sha256: `sha-${year}`,
	lastJobId: `job_${year}`,
	...over,
});

const cand = (year: string | null, over: Partial<Candidate> = {}): Candidate => ({
	familyKey: 'genesis|g80',
	vehicleKey: year ? `genesis|g80|${year}` : null,
	modelYear: year,
	effectiveDate: '2026-10-01',
	sha256: 'sha-new',
	...over,
});

const d = (c: Candidate, r: RegisteredVehicle[], p = policy) => decide(c, r, p, now);

describe('decide (PLAN.md §7.11)', () => {
	it('R1 skips the same file that was already processed — even when forced', () => {
		expect(d(cand('2026', { sha256: 'sha-2026' }), [reg('2026')])).toMatchObject({ action: 'skip', rule: 'R1', existingJobId: 'job_2026' });
		expect(d(cand('2026', { sha256: 'sha-2026', force: true }), [reg('2026')])).toMatchObject({ rule: 'R1' });
	});

	it('R2 skips an older model year (G80 2025 when 2026 exists)', () => {
		expect(d(cand('2025'), [reg('2026')])).toMatchObject({ action: 'skip', rule: 'R2', reason: '이전 연식 (최신: 2026년형)' });
	});

	it('R3 skips a different file of the same year with the same or older date', () => {
		expect(d(cand('2026', { effectiveDate: '2026-10-01' }), [reg('2026')])).toMatchObject({ action: 'skip', rule: 'R3' });
		expect(d(cand('2026', { effectiveDate: '2026-09-01' }), [reg('2026')])).toMatchObject({ action: 'skip', rule: 'R3' });
	});

	it('R4 re-processes a newer price sheet of the same year (policy: process)', () => {
		expect(d(cand('2026', { effectiveDate: '2026-11-01' }), [reg('2026')])).toMatchObject({ action: 'process', rule: 'R4' });
		expect(d(cand('2026', { effectiveDate: '2026-11-01' }), [reg('2026')], { ...policy, sameYearNewerPriceSheet: 'update_candidate' })).toMatchObject({
			action: 'update_candidate',
		});
	});

	it('R4b holds when the dates cannot be compared', () => {
		expect(d(cand('2026', { effectiveDate: null }), [reg('2026')])).toMatchObject({ action: 'hold', rule: 'R4b' });
	});

	it('R5 skips a vehicle that is being processed — even when forced', () => {
		expect(d(cand('2026', { force: true }), [reg('2026', { status: '처리 중' })])).toMatchObject({ action: 'skip', rule: 'R5' });
	});

	it('R6 processes a newer model year (G80 2026 when 2025 exists)', () => {
		expect(d(cand('2026'), [reg('2025')])).toMatchObject({ action: 'process', rule: 'R6', reason: '신규 연식 (2025 → 2026)' });
	});

	it('R7 registers unknown vehicles as baseline on the first scan; R8 processes them afterwards', () => {
		expect(d(cand('2026', { baselineMode: true }), [])).toMatchObject({ action: 'baseline', rule: 'R7' });
		expect(d(cand('2027', { familyKey: 'genesis|gv90', vehicleKey: 'genesis|gv90|2027' }), [])).toMatchObject({ action: 'process', rule: 'R8' });
	});

	it('R9 holds when the model year is unknown, NAME when the vehicle is unknown', () => {
		expect(d(cand(null), [])).toMatchObject({ action: 'hold', rule: 'R9' });
		expect(d(cand('2026', { familyKey: null, vehicleKey: null }), [])).toMatchObject({ action: 'hold', rule: 'NAME' });
	});

	it('R10 holds a stale price sheet', () => {
		expect(d(cand('2026', { effectiveDate: '2025-01-01' }), [])).toMatchObject({ action: 'hold', rule: 'R10' });
	});

	it('R11 processes on explicit user request (older year included)', () => {
		expect(d(cand('2025', { force: true }), [reg('2026')])).toMatchObject({ action: 'process', rule: 'R11' });
	});

	it('baseline vehicles stay baseline until the user asks', () => {
		const base = reg('2026', { status: '기준선' });
		expect(d(cand('2026', { sha256: 'sha-2026' }), [base])).toMatchObject({ action: 'skip', rule: 'BASE' });
		expect(d(cand('2026', { effectiveDate: '2026-11-01' }), [base])).toMatchObject({ action: 'baseline', rule: 'BASE' });
	});

	it('ignores rows marked 이전 연식 when looking for the newest year', () => {
		expect(d(cand('2026'), [reg('2027', { status: '이전 연식' }), reg('2025')])).toMatchObject({ action: 'process', rule: 'R6' });
	});
});

describe('scan helpers', () => {
	it('holds everything when a scan would auto-process more than the cap', () => {
		const items = Array.from({ length: 12 }, (_, i) => ({ id: i, decision: decide(cand('2027', { familyKey: `f${i}`, vehicleKey: `f${i}|2027` }), [], policy, now) }));
		const { items: out, capped } = applyScanCap(items, 10);
		expect(capped).toBe(true);
		expect(out.every((i) => i.decision.action === 'hold')).toBe(true);
		expect(applyScanCap(items.slice(0, 10), 10).capped).toBe(false);
	});

	it('keeps only the latest year per family on one vehicle page', () => {
		const { kept, dropped } = keepLatestPerFamily([
			{ url: 'a', familyKey: 'genesis|g80', modelYear: '2025' },
			{ url: 'b', familyKey: 'genesis|g80', modelYear: '2026' },
			{ url: 'c', familyKey: 'genesis|gv70', modelYear: '2026' },
			{ url: 'd', familyKey: null, modelYear: null },
		]);
		expect(kept.map((k) => k.url)).toEqual(['b', 'c', 'd']);
		expect(dropped).toEqual([{ item: { url: 'a', familyKey: 'genesis|g80', modelYear: '2025' }, reason: '이전 연식 (최신: 2026년형)' }]);
	});
});
