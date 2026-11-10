import { describe, expect, it } from 'vitest';
import { goldenFromCsv, parseCsv } from '../src/eval/golden.ts';
import { evaluate, toMarkdown } from '../src/eval/metrics.ts';
import { pageLookup } from '../src/pipeline/evidence.ts';
import { reconcile } from '../src/pipeline/reconcile.ts';
import { PAGES, sampleExtraction } from './helpers/extraction.ts';

const opts = { pageCount: 4, pages: pageLookup(PAGES), scanned: false };

describe('parseCsv', () => {
	it('handles quotes, commas, BOM and CRLF', () => {
		expect(parseCsv('﻿트림,가격(원)\r\n"카고 3인승, 2WD",41250000\r\n"say ""hi""",1\r\n')).toEqual([
			['트림', '가격(원)'],
			['카고 3인승, 2WD', '41250000'],
			['say "hi"', '1'],
		]);
	});
});

describe('goldenFromCsv', () => {
	it('reads sheet-layout CSVs, filters by vehicle and skips 제외', () => {
		const g = goldenFromCsv(
			{
				trim: '차종,트림,가격(원),상태\n스타리아,카고 3인승,"41,250,000",승인\n스타리아,카고 9인승,1,제외\nG80,2.5T,60000000,승인\n',
				rule: '차종,유형,대상 옵션,관련 항목\n스타리아,상호배제,스마트센스,"빌트인 캠"\n',
				option: '차종,옵션명,가격(원),적용 트림\n스타리아,스마트센스,900000,전 트림\n',
			},
			'스타리아',
		);
		expect(g.trims.map((t) => [t.name, t.price])).toEqual([['카고 3인승', 41_250_000]]);
		expect(g.rules[0]).toMatchObject({ type: 'exclusive', subject: '스마트센스', targets: ['빌트인 캠'] });
		expect(g.options[0].applicableTrims).toEqual(['*']);
	});
});

describe('evaluate', () => {
	it('passes a perfect result', () => {
		const ex = sampleExtraction();
		const r = evaluate('스타리아', reconcile(ex, ex, opts), ex);
		expect(r.auto).toMatchObject({ total: 6, correct: 6, accuracy: 1 });
		expect(r.criticalMisses).toBe(0);
		expect(r.ruleRecall).toBe(1);
		expect(r.pass).toEqual({ autoAccuracy: true, noMissing: true, ruleRecall: true });
	});

	it('catches a wrong auto-confirmed price, a missing option and a missing rule', () => {
		const golden = sampleExtraction();
		golden.trims[0].price = 41_000_000; // the extraction says 41,250,000 and auto-confirmed it
		golden.options.push({ ...golden.options[0], name: '파노라마 선루프' });
		golden.rules.push({ ...golden.rules[0], subject: '빌트인 캠', targets: ['스마트센스'], type: 'requires' });
		const ex = sampleExtraction();
		const r = evaluate('스타리아', reconcile(ex, ex, opts), golden);
		expect(r.auto.wrong).toEqual(['trim:카고 3인승']);
		expect(r.sheets.option.missing).toEqual(['파노라마 선루프']);
		expect(r.criticalMisses).toBe(2); // 1 missing option + 1 wrong trim price
		expect(r.ruleRecall).toBe(0.5);
		expect(r.pass).toEqual({ autoAccuracy: false, noMissing: false, ruleRecall: false });
		expect(toMarkdown([r], 'now')).toContain('| 스타리아 | 83.3% (5/6) ❌ | 2 ❌ | 50.0% ❌ |');
	});
});

describe('splitList (F5)', () => {
	it('keeps an option name that contains a comma together', async () => {
		const { splitList } = await import('../src/eval/golden.ts');
		const known = new Set(['빌트인 캠 2 plus, 증강현실 내비게이션', '멀티미디어 내비플러스']);
		expect(splitList('빌트인 캠 2 Plus, 증강현실 내비게이션, 멀티미디어 내비플러스', known)).toEqual(['빌트인 캠 2 Plus, 증강현실 내비게이션', '멀티미디어 내비플러스']);
		expect(splitList('A, B')).toEqual(['A', 'B']);
		expect(splitList('A, B; C')).toEqual(['A, B', 'C']);
	});
});

describe('fuzzy matching (F4)', () => {
	it('matches names written differently and compares trim lists by matched trim', async () => {
		const { evaluate, looseName } = await import('../src/eval/metrics.ts');
		expect(looseName('테크Ⅰ')).toBe(looseName('테크 I'));
		expect(looseName('드라이빙 어시스턴스 패키지Ⅱ')).toBe(looseName('드라이빙어시스턴스 패키지 II'));
		const golden = sampleExtraction();
		const ex = sampleExtraction();
		ex.trims[0].name = ex.trims[0].name.replace(/\s+/g, ''); // "카고3인승"
		ex.options[0].name = `${ex.options[0].name} `; // stray space
		ex.options[0].applicableTrims = ex.options[0].applicableTrims.map((t) => t.replace(/\s+/g, ''));
		const r = evaluate('스타리아', reconcile(ex, ex, opts), golden);
		expect(r.sheets.trim.missing).toEqual([]);
		expect(r.sheets.option.missing).toEqual([]);
		expect(r.sheets.option.wrong).toEqual([]);
	});

	it('treats 전 트림 as every golden trim', async () => {
		const { sameValues } = await import('../src/eval/metrics.ts');
		const o = sampleExtraction().options[0];
		const ctx = { allTrims: ['카고 3인승', '카고 5인승'], alias: new Map<string, string>() };
		expect(sameValues('option', { ...o, applicableTrims: ['카고 3인승', '카고 5인승'] }, { ...o, applicableTrims: ['*'] }, ctx)).toBe(true);
		expect(sameValues('option', { ...o, applicableTrims: ['카고 3인승'] }, { ...o, applicableTrims: ['*'] }, ctx)).toBe(false);
	});

	it('does not pair genuinely different options', async () => {
		const { similarity, FUZZY_THRESHOLD } = await import('../src/eval/metrics.ts');
		expect(similarity('테크1', '테크2')).toBeLessThan(FUZZY_THRESHOLD);
		expect(similarity('컴포트3인승', '컴포트5인승')).toBeLessThan(FUZZY_THRESHOLD);
	});

	it('never fuzzy-pairs names whose numbers differ, even when long', async () => {
		const { matchItems } = await import('../src/eval/metrics.ts');
		const o = sampleExtraction().options[0];
		const m = matchItems('option', [{ ...o, name: '익스테리어 디자인(3인승)' }], [{ ...o, name: '익스테리어 디자인(5인승)' }]);
		expect(m.pairs).toEqual([]);
		const m2 = matchItems('option', [{ ...o, name: '익스테리어 디자인(3인승)' }], [{ ...o, name: '익스테리어디자인 (3 인승)' }]);
		expect(m2.pairs).toEqual([[0, 0]]);
	});
});

describe('reconcile keys (F3)', () => {
	it('keeps one option at two prices apart and still pairs a single misread price', () => {
		const a = sampleExtraction();
		const base = a.options[0];
		a.options = [
			{ ...base, name: '멀티미디어 내비플러스', price: 1_100_000 },
			{ ...base, name: '멀티미디어 내비플러스', price: 1_050_000 },
		];
		const b = structuredClone(a);
		const r = reconcile(a, b, opts).items.filter((i) => i.sheet === 'option');
		expect(r).toHaveLength(2);
		expect(r.flatMap((i) => i.reasons.map((x) => x.code))).not.toContain('DUPLICATE');

		const c = sampleExtraction();
		const d = sampleExtraction();
		d.options[0].price = (c.options[0].price ?? 0) + 10_000;
		const r2 = reconcile(c, d, opts).items.filter((i) => i.sheet === 'option' && i.key === reconcile(c, d, opts).items.find((x) => x.sheet === 'option')!.key);
		expect(r2[0].reasons.map((x) => x.code)).toContain('PASS_MISMATCH');
	});
});
