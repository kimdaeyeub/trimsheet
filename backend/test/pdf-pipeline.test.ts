import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { buildLayout, layoutLines, renderPages } from '../src/pipeline/pdf-layout.ts';
import { remapPage, subsetPdf, withNeighbours, needsSubset, subsetNote } from '../src/pipeline/pdf-subset.ts';
import { extractPages, type TextItem } from '../src/pipeline/pdf-text.ts';
import { analyzeStructure, relevantPages } from '../src/pipeline/structure.ts';

async function tablePdf(): Promise<ArrayBuffer> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const p1 = doc.addPage([500, 400]);
	p1.drawText('Price list 2027', { x: 40, y: 360, size: 16, font });
	const rows = [
		['Trim', 'Price', 'Note'],
		['Cargo 3', '41,250,000', 'tax 3.5%'],
		['Cargo 5', '42,100,000', ''],
	];
	rows.forEach((r, i) => r.forEach((cell, j) => cell && p1.drawText(cell, { x: 40 + j * 150, y: 300 - i * 24, size: 11, font })));
	const p2 = doc.addPage([500, 400]);
	p2.drawText('Colors page', { x: 40, y: 360, size: 12, font });
	return (await doc.save()).slice().buffer;
}

describe('pdf text + layout', () => {
	it('extracts positioned text and rebuilds table rows with column separators', async () => {
		const pages = await extractPages(await tablePdf());
		expect(pages.map((p) => p.page)).toEqual([1, 2]);
		expect(pages[0].text).toContain('41,250,000');

		const layout = buildLayout(pages);
		const lines = layout[0].text.split('\n');
		expect(lines[0]).toBe('Price list 2027');
		expect(lines).toContain('Trim | Price | Note');
		expect(lines).toContain('Cargo 3 | 41,250,000 | tax 3.5%');
		expect(lines).toContain('Cargo 5 | 42,100,000');
		expect(renderPages(layout, new Set([2]))).toBe('=== p.2 ===\nColors page');
	});

	it('keeps adjacent glyph runs together and splits wide gaps', () => {
		const items: TextItem[] = [
			{ str: '카고', x: 10, y: 100, w: 20, h: 10 },
			{ str: '3인승', x: 33, y: 100.5, w: 30, h: 10 },
			{ str: '41,250,000', x: 200, y: 99.8, w: 60, h: 10 },
			{ str: '다음 줄', x: 10, y: 80, w: 40, h: 10 },
		];
		expect(layoutLines(items)).toEqual(['카고 3인승 | 41,250,000', '다음 줄']);
	});
});

describe('structure', () => {
	const pages = [
		{ page: 1, text: '더 뉴 스타리아 Electric 2027년형 가격표\n2026년 11월 1일 기준' },
		{ page: 2, text: '트림 | 판매가격\n카고 3인승 | 41,250,000\n카고 5인승 | 42,100,000\n라운지 | 50,000,000\n투어러 | 45,300,000' },
		{ page: 3, text: '선택 품목 | 가격\n현대 스마트센스 | 900,000\n※ 1. A와 B는 중복 선택 불가' },
		{ page: 4, text: '외장 컬러 | 내장 색상\n크리미 화이트' },
		{ page: 5, text: '고객센터 안내' },
	];

	it('maps sections to pages and recognises a price sheet', () => {
		const s = analyzeStructure(pages);
		expect(s.pageMap).toEqual({ cover: [1], price: [2], color: [4], option: [3], footnote: [3], other: [5] });
		expect(s.looksLikePriceSheet).toBe(true);
		expect(s.isScanned).toBe(false);
		expect([...relevantPages(s.pageMap, 'rules')].sort()).toEqual([2, 3]);
	});

	it('flags scanned PDFs and catalogues without prices', () => {
		expect(analyzeStructure([{ page: 1, text: '' }, { page: 2, text: 'ab' }]).isScanned).toBe(true);
		expect(analyzeStructure([{ page: 1, text: '디자인 카탈로그 외장 컬러 내장 색상' }]).looksLikePriceSheet).toBe(false);
	});
});

describe('pdf subset', () => {
	it('copies selected pages and maps page numbers back', async () => {
		const bytes = await tablePdf();
		const sub = await subsetPdf(bytes, [2]);
		expect((await PDFDocument.load(sub.bytes)).getPageCount()).toBe(1);
		expect(remapPage(1, sub.originalPages)).toBe(2);
		expect(subsetNote([3, 7])).toContain('1→p.3, 2→p.7');
	});

	it('adds neighbouring pages and decides when a subset is needed', () => {
		expect(withNeighbours([1, 5], 6)).toEqual([1, 2, 4, 5, 6]);
		expect(needsSubset(1_000_000, 20)).toBe(false);
		expect(needsSubset(10 * 1024 * 1024, 20)).toBe(true);
		expect(needsSubset(1_000, 120)).toBe(true);
	});
});
