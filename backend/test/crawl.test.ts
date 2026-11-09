// Parsers tested against shapes observed on the real sites on 2026-11-10 (docs/site-notes.md).
import { describe, expect, it, vi } from 'vitest';

// The Workers-only browser client cannot load in Node; parsers do not need it.
vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn() }));
import { parseGenesisHtml } from '../src/crawl/adapters/genesis.ts';
import { cleanHyundaiName, parseHyundaiCards } from '../src/crawl/adapters/hyundai.ts';
import { parseKiaCards } from '../src/crawl/adapters/kia.ts';
import { genesisPdfUrl, requestFor, unchanged } from '../src/crawl/fetch-pdf.ts';
import { classifyLinks, guessKind, keepLatestYear } from '../src/crawl/generic.ts';
import { isCommercial } from '../src/crawl/types.ts';

describe('hyundai', () => {
	it('cleans card text', () => {
		expect(cleanHyundaiName('NEW  디 올 뉴 투싼  3,140만원~')).toBe('디 올 뉴 투싼');
		expect(cleanHyundaiName('코나 Electric  4,152만원~ N line포함')).toBe('코나 Electric');
	});

	it('derives price URLs from slugs and skips commercial vehicles', () => {
		const { refs, skipped } = parseHyundaiCards([
			{ href: '/kr/ko/e/vehicles/the-new-staria-electric/intro', text: '더 뉴 스타리아 Electric  5,792만원~' },
			{ href: '/kr/ko/e/vehicles/the-new-staria-electric/intro', text: '자세히 보기' },
			{ href: '/kr/ko/e/vehicles/porter2-electric/intro', text: '포터 II Electric  4,350만원~' },
			{ href: '/kr/ko/e/vehicles/sonata-taxi/intro', text: '쏘나타 택시 2,595만원~' },
			{ href: '/kr/ko/e/vehicles/st1/intro', text: 'ST1  5,738만원~' },
		]);
		expect(refs).toEqual([
			{
				brand: 'hyundai',
				vehicleName: '더 뉴 스타리아 Electric',
				url: 'https://www.hyundai.com/contents/repn-car/catalog/the-new-staria-electric_price.pdf',
				method: 'GET',
				siteKey: 'the-new-staria-electric',
				filename: 'the-new-staria-electric_price.pdf',
			},
		]);
		expect(skipped.map((s) => s.vehicleName)).toEqual(['포터 II Electric', '쏘나타 택시', 'ST1']);
	});
});

describe('kia', () => {
	it('keeps passenger cards, skips commercial tabs and dedupes shared PDFs', () => {
		const { refs, skipped } = parseKiaCards([
			{ tab: 'EV', name: 'EV3 카탈로그 가격표', href: '/content/dam/kwp/kr/ko/vehicles/pdf/price/price_ev3.pdf' },
			{ tab: 'EV', name: '봉고Ⅲ EV 카탈로그 가격표', href: '/content/dam/kwp/kr/ko/vehicles/pdf/price/price_bongo3-ev.pdf' },
			{ tab: 'PBV', name: 'PV5 패신저 카탈로그 가격표', href: '/content/dam/kwp/kr/ko/vehicles/pdf/price/price_pv5-passenger.pdf' },
			{ tab: 'PBV', name: 'PV5 카고 롱 카탈로그 가격표', href: '/content/dam/kwp/kr/ko/vehicles/pdf/price/price_pv5-cargo.pdf' },
			{ tab: 'RV', name: '쏘렌토 카탈로그 가격표', href: '/content/dam/kwp/kr/ko/vehicles/pdf/price/price_sorento.pdf' },
			{ tab: 'RV', name: '쏘렌토 (중복) 카탈로그 가격표', href: '/content/dam/kwp/kr/ko/vehicles/pdf/price/price_sorento.pdf' },
			{ tab: '택시 & 상용', name: 'K8 택시 카탈로그 가격표', href: '/content/dam/kwp/kr/ko/vehicles/pdf/price/price_k8-taxi.pdf' },
			{ tab: '승용', name: '모닝 카탈로그', href: null },
		]);
		expect(refs.map((r) => [r.vehicleName, r.siteKey])).toEqual([
			['EV3', 'ev3'],
			['PV5 패신저', 'pv5-passenger'],
			['쏘렌토', 'sorento'],
		]);
		expect(refs[0].url).toBe('https://www.kia.com/content/dam/kwp/kr/ko/vehicles/pdf/price/price_ev3.pdf');
		expect(skipped.map((s) => s.reason)).toEqual(['상용·택시', '상용·택시', '상용·택시', '가격표 링크 없음']);
	});
});

describe('genesis', () => {
	const a = (key: string, file: string, label: string) =>
		`<a class="card-link" href="javascript:viewPdf('${key}','${file}','BROCHURE')"><span>PDF</span> ${label} 가격표</a>`;
	const html = [
		a('1185760DEF092FC162', 'genesis-g80-pricelist-kor-202611.pdf', 'G80'),
		`<a class="card-link" href="javascript:viewPdf('1185760DEF092F8F5E','genesis-g80-catalog-kor-202611.pdf','CATALOG')">PDF G80 카탈로그</a>`,
		a('11908532710A4EC54C', 'genesis-g90-pricelist-kor-202506.pdf', 'G90'),
		a('1187CA750AB5DCF580', 'genesis-g90-pricelist-kor-202611.pdf', 'G90'),
		a('118E3B4F09C70B5E3C', 'genesis-g90-long-wheel-base-pricelist-kor-202611.pdf', 'G90 Long Wheel Base'),
	].join('\n');

	it('lists price sheets only, newest per model, as POST refs', () => {
		const { refs, skipped } = parseGenesisHtml(html);
		expect(refs.map((r) => [r.vehicleName, r.siteKey, r.publishedYm])).toEqual([
			['G80', 'g80', '202611'],
			['G90', 'g90', '202611'],
			['G90 Long Wheel Base', 'g90-long-wheel-base', '202611'],
		]);
		expect(refs[1]).toMatchObject({ method: 'POST', form: { file_key: '1187CA750AB5DCF580' }, url: genesisPdfUrl('1187CA750AB5DCF580') });
		expect(skipped).toEqual([{ vehicleName: 'G90 (202506)', reason: '이전 가격표 (최신 202611)' }]);
	});
});

describe('fetch helpers', () => {
	it('turns recorded Genesis URLs back into POST requests', () => {
		expect(requestFor(genesisPdfUrl('ABC'))).toEqual({
			url: 'https://www.genesis.com/wsvc/kr/api/v2/download-center/pdfview',
			method: 'POST',
			form: { file_key: 'ABC' },
		});
		expect(requestFor('https://www.kia.com/a.pdf')).toEqual({ url: 'https://www.kia.com/a.pdf', method: 'GET' });
	});

	it('decides L1 "unchanged" from ETag / Last-Modified, or the URL itself for POST refs', () => {
		expect(unchanged(null, { etag: 'x', lastModified: '' })).toBe(false);
		expect(unchanged({ etag: 'x' }, { etag: 'x', lastModified: '' })).toBe(true);
		expect(unchanged({ etag: 'x', lastModified: 'Mon' }, { etag: 'y', lastModified: 'Tue' })).toBe(false);
		expect(unchanged({ lastModified: 'Mon' }, { etag: '', lastModified: 'Mon' })).toBe(true);
		expect(unchanged({}, null)).toBe(true);
	});

	it('flags commercial names', () => {
		expect(['포터 II', '봉고Ⅲ EV', 'PV5 카고 롱', '그랜저 택시', '카운티'].every(isCommercial)).toBe(true);
		expect(['더 뉴 그랜저', 'PV5 패신저', 'GV80 Coupe'].some(isCommercial)).toBe(false);
	});
});

describe('generic link classification', () => {
	it('keeps PDFs, ranks price sheets first, drops archive links and older years', () => {
		const { candidates, dropped } = classifyLinks(
			[
				{ href: '/files/2026_catalog.pdf', text: '카탈로그' },
				{ href: '/files/price_2027.pdf', text: '2027년형 가격표' },
				{ href: '/files/price_2026.pdf', text: '2026년형 가격표' },
				{ href: '/files/old_price.pdf', text: '지난 가격표' },
				{ href: '/page.html', text: '가격표' },
				{ href: "javascript:viewPdf('KEY1','genesis-gv70-pricelist-kor-202611.pdf','BROCHURE')", text: 'PDF GV70 가격표' },
			],
			'https://www.hyundai.com/kr/ko/e/vehicles/x/intro',
		);
		expect(candidates.map((c) => c.guessKind)).toEqual(['pricesheet', 'pricesheet', 'pricesheet', 'catalog']);
		expect(dropped).toEqual([{ url: 'https://www.hyundai.com/files/old_price.pdf', reason: '이전/지난 가격표 링크' }]);
		const latest = keepLatestYear(candidates);
		expect(latest.candidates.map((c) => c.url)).not.toContain('https://www.hyundai.com/files/price_2026.pdf');
		expect(latest.dropped[0].reason).toBe('이전 연식 (최신: 2027년형)');
		expect(guessKind('a.pdf', '카탈로그')).toBe('catalog');
	});
});
