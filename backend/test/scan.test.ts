// Scan scenarios from PLAN.md Phase 6.11 with a fake site, fake downloads and the memory sheet.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfRef } from '../src/crawl/types.ts';
import { scanBrand, type ScanDeps } from '../src/scan/scan.ts';
import { MemorySheetsPort } from '../src/sheets/memory.ts';
import { SheetsRepo, resetLayoutMemo } from '../src/sheets/repo.ts';
import { FakeR2, asBucket } from './helpers/fake-r2.ts';

vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn() }));

async function pdf(text: string): Promise<ArrayBuffer> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	doc.addPage([400, 300]).drawText(text, { x: 30, y: 250, size: 12, font });
	return (await doc.save()).slice().buffer;
}

/** A fake manufacturer site: url → { name, cover text, etag }. */
class FakeSite {
	files = new Map<string, { name: string; cover: string; etag: string }>();
	downloads: string[] = [];
	set(slug: string, name: string, cover: string, etag = 'e1') {
		this.files.set(`https://www.kia.com/pdf/price_${slug}.pdf`, { name, cover, etag });
	}
	refs(): PdfRef[] {
		return [...this.files].map(([url, f]) => ({ brand: 'kia', vehicleName: f.name, url, method: 'GET', siteKey: url }));
	}
}

let site: FakeSite;
let repo: SheetsRepo;
let jobs: { conversationId: string; sourceId: string; note: string }[];
let deps: ScanDeps;

beforeEach(() => {
	resetLayoutMemo();
	site = new FakeSite();
	repo = new SheetsRepo(new MemorySheetsPort(), 'mem');
	jobs = [];
	deps = {
		repo,
		bucket: asBucket(new FakeR2()),
		list: async () => ({ refs: site.refs(), skipped: [] }),
		probe: async (url) => ({ exists: site.files.has(url), etag: site.files.get(url)?.etag ?? '', lastModified: '' }),
		download: async (ref) => {
			site.downloads.push(ref.url);
			const f = site.files.get(ref.url)!;
			return { bytes: await pdf(f.cover), etag: f.etag, lastModified: '', filename: ref.url.split('/').pop()! };
		},
		startJob: async (j) => void jobs.push(j),
		step: (_n, fn) => fn(),
		sleep: async () => {},
		now: new Date('2026-11-10T00:00:00Z'),
	};
});

describe('scanBrand', () => {
	it('first scan registers a baseline without starting any job', async () => {
		site.set('ev3', 'EV3', 'EV3 2027 MY price list');
		site.set('k5', 'K5', 'K5 2026 MY price list');
		const s = await scanBrand(deps, 'kia', 'baseline');
		expect(s.counts).toEqual({ process: 0, baseline: 2, skip: 0, hold: 0 });
		expect(jobs).toEqual([]);
		const reg = await repo.listVehicles();
		expect(reg.map((v) => [v.vehicleKey, v.status])).toEqual([
			['kia|ev3|2027', '기준선'],
			['kia|k5|2026', '기준선'],
		]);
	});

	it('second scan with no changes does not download anything', async () => {
		site.set('ev3', 'EV3', 'EV3 2027 MY price list');
		await scanBrand(deps, 'kia', 'baseline');
		site.downloads = [];
		const s = await scanBrand(deps, 'kia', 'normal');
		expect(site.downloads).toEqual([]);
		expect(s.unchanged).toBe(1);
		expect(jobs).toEqual([]);
	});

	it('processes only a brand-new vehicle after the baseline', async () => {
		site.set('ev3', 'EV3', 'EV3 2027 MY price list');
		await scanBrand(deps, 'kia', 'baseline');
		site.set('ev2', 'EV2', 'EV2 2027 MY price list');
		const s = await scanBrand(deps, 'kia', 'normal');
		expect(s.counts.process).toBe(1);
		expect(jobs).toHaveLength(1);
		expect(jobs[0].note).toContain('신차');
		expect((await repo.listConversations())[0].title).toBe('EV2 (자동 수집)');
	});

	it('processes a new model year of a known vehicle and infers a missing year', async () => {
		site.set('ev3', 'EV3', 'EV3 2026 MY price list');
		await scanBrand(deps, 'kia', 'baseline');
		site.set('ev3', 'EV3', 'EV3 2027 MY price list', 'e2'); // same URL, new file
		site.set('ray', 'Ray', 'Ray price list'); // no model year on the cover
		const s = await scanBrand(deps, 'kia', 'normal');
		const by = Object.fromEntries(s.items.map((i) => [i.vehicleName, i.decision]));
		expect(by.EV3).toMatchObject({ action: 'process', rule: 'R6' });
		// No "20XX년형" on the cover (true of every real 2026-11 sample): the year is inferred, not held.
		expect(by.Ray).toMatchObject({ action: 'process', rule: 'R8' });
		expect(s.items.find((i) => i.vehicleName === 'Ray')?.identity?.modelYear).toMatch(/^20\d{2}$/);
	});

	it('holds everything when too many vehicles would be processed at once', async () => {
		await repo.setSetting('baseline_done', 'TRUE');
		for (let i = 0; i < 11; i++) site.set(`car${i}`, `CAR${i}`, `CAR${i} 2027 MY price list`);
		const s = await scanBrand(deps, 'kia', 'normal');
		expect(s.capped).toBe(true);
		expect(s.counts.process).toBe(0);
		expect(s.counts.hold).toBe(11);
		expect(jobs).toEqual([]);
	});

	it('records site failures and keeps going when one PDF fails', async () => {
		site.set('ev3', 'EV3', 'EV3 2027 MY price list');
		site.set('bad', 'BAD', 'x');
		const original = deps.download;
		deps.download = async (ref) => (ref.url.includes('bad') ? Promise.reject(new Error('download_failed')) : original(ref));
		const s = await scanBrand(deps, 'kia', 'baseline');
		expect(s.failures).toEqual(['BAD: download_failed']);
		expect(s.counts.baseline).toBe(1);
		deps.list = async () => ({ refs: [], skipped: [], failure: '사이트 구조 변경 의심' });
		expect((await scanBrand(deps, 'kia', 'normal')).failures).toEqual(['기아: 사이트 구조 변경 의심']);
	});
});
