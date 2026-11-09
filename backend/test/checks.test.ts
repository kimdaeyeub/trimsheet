import { describe, expect, it } from 'vitest';
import { pageLookup, verifyQuote } from '../src/pipeline/evidence.ts';
import { checkQuality } from '../src/pipeline/quality.ts';
import { reconcile, summarize } from '../src/pipeline/reconcile.ts';
import { contextFor, ruleConflicts, validateOption, validateRule, validateTrim } from '../src/pipeline/validate.ts';
import { PAGES, sampleExtraction } from './helpers/extraction.ts';

const pages = pageLookup(PAGES);

describe('evidence', () => {
	it('finds exact quotes ignoring spacing/width, on the page or a neighbour', () => {
		expect(verifyQuote(pages, 2, '카고 3인승  41,250,000')).toBe(true);
		expect(verifyQuote(pages, 3, '크리미 화이트 WW2')).toBe(true); // on p.4, neighbour of p.3
		expect(verifyQuote(pages, 1, '크리미 화이트 WW2')).toBe(false);
	});

	it('accepts small OCR-like differences but rejects invented text', () => {
		expect(verifyQuote(pages, 3, '스마트센스와 빌트인캠은 중복선택 불가')).toBe(true);
		expect(verifyQuote(pages, 3, '파노라마 선루프 1,200,000')).toBe(false);
	});
});

describe('validate', () => {
	const ex = sampleExtraction();
	const ctx = contextFor(ex, 4);

	it('flags bad prices, low confidence and out-of-range pages', () => {
		expect(validateTrim({ ...ex.trims[0], price: 41.5 }, ctx).map((r) => r.code)).toContain('INVALID_PRICE');
		expect(validateTrim({ ...ex.trims[0], price: 400_000_000 }, ctx).map((r) => r.code)).toContain('INVALID_PRICE');
		expect(validateTrim({ ...ex.trims[0], confidence: 'medium' }, ctx).map((r) => r.code)).toEqual(['LOW_CONFIDENCE']);
		expect(validateTrim({ ...ex.trims[0], evidence: { page: 9, quote: 'x' } }, ctx).map((r) => r.code)).toEqual(['EVIDENCE_NOT_FOUND']);
		expect(validateTrim(ex.trims[0], ctx)).toEqual([]);
	});

	it('flags references to trims/options that do not exist', () => {
		expect(validateOption({ ...ex.options[0], applicableTrims: ['라운지'] }, ctx)[0]).toMatchObject({ code: 'UNKNOWN_REFERENCE' });
		expect(validateRule({ ...ex.rules[0], targets: ['없는 옵션'] }, ctx)[0]).toMatchObject({ code: 'UNKNOWN_REFERENCE' });
		expect(validateRule({ ...ex.rules[0], type: 'other' }, ctx).map((r) => r.code)).toEqual(['RULE_OTHER']);
	});

	it('detects contradictory rules', () => {
		const requires = { ...ex.rules[0], type: 'requires' as const, subject: '빌트인 캠', targets: ['스마트센스'] };
		const conflicts = ruleConflicts([ex.rules[0], requires]);
		expect(conflicts.size).toBe(2);
		expect(ruleConflicts(ex.rules).size).toBe(0);
	});
});

describe('quality', () => {
	it('passes a good extraction and fails an empty or unsupported one', () => {
		expect(checkQuality(sampleExtraction(), { looksLikePriceSheet: true, pages }).ok).toBe(true);
		const empty = { ...sampleExtraction(), trims: [] };
		expect(checkQuality(empty, { looksLikePriceSheet: true, pages }).reason).toMatch(/트림을 하나도/);
		const invented = sampleExtraction();
		for (const t of [...invented.trims, ...invented.options]) t.evidence.quote = '지어낸 문장입니다 12345';
		expect(checkQuality(invented, { looksLikePriceSheet: true, pages }).reason).toMatch(/근거 원문 불일치/);
	});
});

describe('reconcile', () => {
	const opts = { pageCount: 4, pages, scanned: false };

	it('auto-confirms everything when both passes agree and checks pass', () => {
		const r = reconcile(sampleExtraction(), sampleExtraction(), opts);
		expect(r.counts).toEqual({ trims: 2, colors: 1, options: 2, rules: 1, review: 0 });
		expect(r.items.every((i) => i.status === '자동 확정')).toBe(true);
	});

	it('marks mismatches and one-sided items for review', () => {
		const b = sampleExtraction();
		b.trims[0].price = 41_000_000;
		b.options = b.options.slice(0, 1);
		b.rules[0].targets = ['빌트인 캠'];
		b.colors.push({ ...b.colors[0], name: '어비스 블랙', code: 'A2B', evidence: { page: 4, quote: '크리미 화이트 WW2' } });
		const r = reconcile(sampleExtraction(), b, opts);
		const by = (name: string) => r.items.find((i) => 'name' in i.final && i.final.name === name)!;
		expect(by('카고 3인승').reasons).toEqual([{ code: 'PASS_MISMATCH', detail: '가격: 41250000 / 41000000' }]);
		expect(by('빌트인 캠').reasons.map((x) => x.code)).toEqual(['ONLY_IN_A']);
		expect(by('어비스 블랙').reasons.map((x) => x.code)).toEqual(['ONLY_IN_B']);
		expect(by('카고 5인승').status).toBe('자동 확정');
		expect(r.counts.review).toBe(3);
	});

	it('single-pass mode does not report ONLY_IN_A; scanned PDFs are always reviewed', () => {
		expect(reconcile(sampleExtraction(), null, opts).counts.review).toBe(0);
		const scanned = reconcile(sampleExtraction(), null, { pageCount: 4, pages: null, scanned: true });
		expect(scanned.items.every((i) => i.reasons.some((x) => x.code === 'SCANNED_PDF'))).toBe(true);
	});

	it('treats fallback and hex notes as informational only', () => {
		const a = sampleExtraction();
		a.colors[0].hex = '#EDEBE4';
		const r = reconcile(a, null, { ...opts, fallbackA: true });
		const color = r.items.find((i) => i.sheet === 'color')!;
		expect(color.reasons.map((x) => x.code)).toEqual(['FALLBACK_MODEL', 'HEX_APPROX']);
		expect(color.status).toBe('자동 확정');
	});

	it('summarises items for the review tab', () => {
		const ex = sampleExtraction();
		expect(summarize('trim', ex.trims[0])).toBe('카고 3인승 · 41,250,000원');
		expect(summarize('rule', ex.rules[0])).toBe('스마트센스 선택 → 빌트인 캠 선택 불가');
		expect(summarize('option', null)).toBe('없음');
	});
});
