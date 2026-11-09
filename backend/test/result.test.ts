import { beforeEach, describe, expect, it } from 'vitest';
import { pageLookup } from '../src/pipeline/evidence.ts';
import { reconcile } from '../src/pipeline/reconcile.ts';
import { MemorySheetsPort } from '../src/sheets/memory.ts';
import { SheetsRepo, resetLayoutMemo } from '../src/sheets/repo.ts';
import { writeJobResult } from '../src/sheets/result.ts';
import { toRecords } from '../src/sheets/rows.ts';
import { TABS } from '../src/sheets/layout.ts';
import { PAGES, sampleExtraction } from './helpers/extraction.ts';

let port: MemorySheetsPort;
let repo: SheetsRepo;
beforeEach(() => {
	resetLayoutMemo();
	port = new MemorySheetsPort();
	repo = new SheetsRepo(port, 'mem');
});

const rows = (tab: { title: string }) => toRecords(tab as never, port.tabs.get(tab.title)?.rows ?? []);
const vehicle = (jobId: string, vehicleName = '더 뉴 스타리아 Electric', modelYear = '2027') => ({ jobId, brand: 'hyundai' as const, vehicleName, modelYear });
const opts = { pageCount: 4, pages: pageLookup(PAGES), scanned: false };

describe('writeJobResult', () => {
	it('writes every sheet plus the review tab with Korean labels', async () => {
		const b = sampleExtraction();
		b.trims[0].price = 41_000_000;
		const summary = await writeJobResult(repo, vehicle('job_1'), reconcile(sampleExtraction(), b, opts));
		expect(summary).toEqual({ written: { trim: 2, color: 1, option: 2, rule: 1 }, review: 1, replacedRows: 0 });

		const trims = rows(TABS.trim);
		expect(trims[0].values).toMatchObject({ jobId: 'job_1', brand: '현대', name: '카고 3인승', price: '41250000', status: '확인 필요', evidencePage: '2' });
		expect(trims[0].values.reviewReasons).toBe('1·2차 불일치(가격: 41250000 / 41000000)');
		expect(rows(TABS.rule)[0].values).toMatchObject({ type: '상호배제', targets: '빌트인 캠' });
		expect(rows(TABS.color)[0].values).toMatchObject({ kind: '외장', applicableTrims: '전 트림' });

		const review = rows(TABS.review);
		expect(review).toHaveLength(1);
		expect(review[0].values).toMatchObject({ sheet: '트림', label: '카고 3인승', passA: '카고 3인승 · 41,250,000원', passB: '카고 3인승 · 41,000,000원', progress: '대기' });
		expect(review[0].values.itemId).toBe(trims[0].values.itemId);
	});

	it('replaces the earlier result of the same vehicle but keeps other vehicles', async () => {
		const r = reconcile(sampleExtraction(), null, opts);
		await writeJobResult(repo, vehicle('job_old', '스타리아 Electric'), r);
		await writeJobResult(repo, vehicle('job_other', 'G80', '2026'), r);
		const summary = await writeJobResult(repo, vehicle('job_new'), r); // "더 뉴 스타리아 Electric" = same family
		expect(summary.replacedRows).toBe(6);
		expect(new Set(rows(TABS.trim).map((x) => x.values.jobId))).toEqual(new Set(['job_other', 'job_new']));
	});

	it('paints colour preview cells when a hex is known', async () => {
		const a = sampleExtraction();
		a.colors[0].hex = '#EDEBE4';
		await writeJobResult(repo, vehicle('job_1'), reconcile(a, null, opts));
		const previewCol = TABS.color.columns.findIndex((c) => c.key === 'preview') + 1;
		expect(port.tabs.get('색상')?.backgrounds.get(`2:${previewCol}`)).toBe('#EDEBE4');
	});
});

describe('vehicle registry', () => {
	it('upserts vehicles and marks older years', async () => {
		await repo.upsertVehicle({ vehicleKey: 'genesis|g80|2025', familyKey: 'genesis|g80', modelYear: '2025', status: '처리 완료' });
		await repo.upsertVehicle({ vehicleKey: 'genesis|g80|2026', familyKey: 'genesis|g80', modelYear: '2026', status: '처리 중' });
		await repo.upsertVehicle({ vehicleKey: 'genesis|g80|2026', status: '처리 완료', lastJobId: 'job_9' });
		expect(await repo.markOlderYears('genesis|g80', '2026')).toBe(1);
		const list = await repo.listVehicles();
		expect(list.map((v) => [v.vehicleKey, v.status, v.lastJobId])).toEqual([
			['genesis|g80|2025', '이전 연식', ''],
			['genesis|g80|2026', '처리 완료', 'job_9'],
		]);
	});

	it('creates and updates job rows', async () => {
		await repo.createJobRow({ jobId: 'job_1', stage: 'created', filename: 'a.pdf' });
		await repo.updateJobRow('job_1', { stage: 'finalized', trimCount: '2' });
		expect(await repo.getJob('job_1')).toMatchObject({ stage: 'finalized', trimCount: '2', filename: 'a.pdf' });
	});
});
