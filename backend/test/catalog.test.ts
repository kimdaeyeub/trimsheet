import { beforeEach, describe, expect, it } from 'vitest';
import type { CatalogDetail, CatalogPage } from '@shared/types';
import { buildCatalog, paginate, type CatalogRows } from '../src/catalog/catalog.ts';
import { resetCatalogCache } from '../src/routes/catalog.ts';
import { api } from '../src/routes/index.ts';
import { getRepo, resetMemorySheets } from '../src/sheets/index.ts';
import { resetLayoutMemo } from '../src/sheets/repo.ts';
import { makeEnv } from './helpers/env.ts';

const head = (jobId: string, vehicleName: string, extra: Record<string, string> = {}) => ({
	jobId,
	brand: extra.brand ?? '현대',
	vehicleName,
	modelYear: extra.modelYear ?? '2026',
	status: extra.status ?? '자동 확정',
	updatedAt: extra.updatedAt ?? '2026-11-10 10:00:00',
});

function rows(): CatalogRows {
	return {
		items: {
			trim: [
				{ ...head('job_old', '스타리아'), name: '카고 3인승', price: '41000000' },
				{ ...head('job_new', '스타리아'), name: '카고 3인승', price: '41250000' },
				{ ...head('job_new', '스타리아'), name: '투어러 9인승', price: '45000000', status: '확인 필요' },
				{ ...head('job_new', '스타리아'), name: '빠진 트림', price: '1', status: '제외' },
				{ ...head('job_g80', 'G80', { brand: '제네시스' }), name: '기본 모델', price: '60630000' },
				{ ...head('job_k', '쏘렌토', { brand: '기아' }), name: '프레스티지', price: '36410000' },
			],
			color: [{ ...head('job_new', '스타리아'), kind: '외장', name: '크리미 화이트', code: 'YAC', applicableTrims: '전 트림' }],
			option: [{ ...head('job_new', '스타리아'), name: '빌트인 캠', price: '670000', applicableTrims: '전 트림' }],
			rule: [{ ...head('job_new', '스타리아'), type: '상호배제', subject: '빌트인 캠', targets: '트윈 스윙 도어' }],
		},
		jobs: [
			{ jobId: 'job_old', createdAt: '2026-05-01 09:00:00', effectiveDate: '2026-04-01', pdfKey: 'pdf/a.pdf' },
			{ jobId: 'job_new', createdAt: '2026-11-01 09:00:00', effectiveDate: '2026-10-23', pdfKey: 'pdf/b.pdf', sourceUrl: 'https://example.com/b.pdf' },
		],
	};
}

describe('buildCatalog', () => {
	it('groups by vehicle, keeps only the latest job and drops 제외 rows', () => {
		const cat = buildCatalog(rows());
		expect(cat.map((v) => v.vehicleName)).toEqual(['스타리아', '쏘렌토', 'G80']); // 현대 → 기아 → 제네시스
		const s = cat[0];
		expect(s).toMatchObject({ id: 'job_new', effectiveDate: '2026-10-23', trimCount: 2, colorCount: 1, optionCount: 1, ruleCount: 1, reviewCount: 1 });
		expect(s.trims.map((t) => t.price)).toEqual([41_250_000, 45_000_000]);
		expect([s.priceFrom, s.priceTo]).toEqual([41_250_000, 45_000_000]);
		expect(s.pdfUrl).toBe('/api/files/pdf/b.pdf');
	});
});

describe('paginate', () => {
	const many = (n: number): CatalogDetail[] =>
		buildCatalog({
			items: { trim: Array.from({ length: n }, (_, i) => ({ ...head(`job_${i}`, `차${String(i).padStart(2, '0')}`), name: 'T', price: '1' })), color: [], option: [], rule: [] },
			jobs: [],
		});

	it('pages, clamps out-of-range pages and caps the page size', () => {
		const cat = many(25);
		expect(paginate(cat, { page: 2, pageSize: 10 })).toMatchObject({ page: 2, total: 25, totalPages: 3 });
		expect(paginate(cat, { page: 2, pageSize: 10 }).items.map((v) => v.vehicleName)[0]).toBe('차10');
		expect(paginate(cat, { page: 99, pageSize: 10 }).page).toBe(3);
		expect(paginate(cat, { pageSize: 1000 }).pageSize).toBe(50);
		expect(paginate([], {})).toMatchObject({ items: [], total: 0, totalPages: 1, page: 1 });
	});

	it('filters by brand and search text, and reports brand counts before filtering', () => {
		const cat = buildCatalog(rows());
		const p = paginate(cat, { brand: '기아' });
		expect(p.items.map((v) => v.vehicleName)).toEqual(['쏘렌토']);
		expect(p.brands).toEqual({ 현대: 1, 기아: 1, 제네시스: 1 });
		expect(paginate(cat, { q: 'g 80' }).items.map((v) => v.vehicleName)).toEqual(['G80']);
	});

	it('does not send detail arrays in the list', () => {
		expect(Object.keys(paginate(buildCatalog(rows()), {}).items[0])).not.toContain('trims');
	});
});

describe('GET /api/catalog', () => {
	beforeEach(() => {
		resetMemorySheets();
		resetLayoutMemo();
		resetCatalogCache();
	});

	it('lists vehicles from the sheet and returns one in detail', async () => {
		const { env } = makeEnv();
		const repo = getRepo(env);
		await repo.createJobRow({ jobId: 'job_1', brand: '기아', vehicleName: '쏘렌토', modelYear: '2026' });
		// Append a trim row through the generic sheet port, as writeJobResult does.
		await repo.port.append('트림', [['i1', 'job_1', '기아', '쏘렌토', '2026', '프레스티지', 36410000, '', '', 1, '', '자동 확정', '', '2026-11-10 10:00:00']]);

		const page = (await (await api.request('http://t/catalog?page=1&pageSize=5', undefined, env)).json()) as CatalogPage;
		expect(page).toMatchObject({ total: 1, page: 1, pageSize: 5 });
		expect(page.items[0]).toMatchObject({ id: 'job_1', vehicleName: '쏘렌토', trimCount: 1, priceFrom: 36_410_000 });

		const detail = (await (await api.request('http://t/catalog/job_1', undefined, env)).json()) as CatalogDetail;
		expect(detail.trims[0]).toMatchObject({ name: '프레스티지', price: 36_410_000 });
		expect((await api.request('http://t/catalog/nope', undefined, env)).status).toBe(404);
	});
});
