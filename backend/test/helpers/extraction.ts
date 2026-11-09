import type { Extraction } from '../../src/pipeline/schema.ts';

/** A small, internally consistent extraction whose quotes appear in `PAGES`. */
export const PAGES = [
	{ page: 1, text: '더 뉴 스타리아 Electric 2027년형 가격표 2026년 11월 1일 기준' },
	{ page: 2, text: '트림 판매가격\n카고 3인승 41,250,000\n카고 5인승 42,100,000' },
	{ page: 3, text: '선택 품목\n스마트센스 900,000\n빌트인 캠 450,000\n※1 스마트센스와 빌트인 캠은 중복 선택 불가' },
	{ page: 4, text: '외장 컬러\n크리미 화이트 WW2' },
];

export function sampleExtraction(): Extraction {
	const ev = (page: number, quote: string) => ({ page, quote });
	return {
		document: { isPriceSheet: true, brand: 'hyundai', vehicleName: '더 뉴 스타리아 Electric', modelYear: '2027', effectiveDate: '2026-11-01', notes: [] },
		trims: [
			{ name: '카고 3인승', price: 41_250_000, evidence: ev(2, '카고 3인승 41,250,000'), confidence: 'high' },
			{ name: '카고 5인승', price: 42_100_000, evidence: ev(2, '카고 5인승 42,100,000'), confidence: 'high' },
		],
		colors: [
			{ kind: 'exterior', name: '크리미 화이트', code: 'WW2', hex: null, applicableTrims: ['*'], evidence: ev(4, '크리미 화이트 WW2'), confidence: 'high' },
		],
		options: [
			{ name: '스마트센스', price: 900_000, applicableTrims: ['카고 3인승', '카고 5인승'], includes: [], evidence: ev(3, '스마트센스 900,000'), confidence: 'high' },
			{ name: '빌트인 캠', price: 450_000, applicableTrims: ['*'], includes: [], evidence: ev(3, '빌트인 캠 450,000'), confidence: 'high' },
		],
		rules: [
			{
				type: 'exclusive',
				subject: '스마트센스',
				targets: ['빌트인 캠'],
				condition: '스마트센스 선택',
				result: '빌트인 캠 선택 불가',
				footnoteText: '※1 스마트센스와 빌트인 캠은 중복 선택 불가',
				evidence: { page: 3, quote: '스마트센스와 빌트인 캠은 중복 선택 불가', footnote: '※1' },
				confidence: 'high',
			},
		],
	};
}
