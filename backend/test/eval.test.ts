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
