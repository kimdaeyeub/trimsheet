import { describe, expect, it } from 'vitest';
import { familyKey, familyName, guessBrand, identify, parseEffectiveDate, parseModelYear } from '../src/pipeline/identity.ts';

const now = new Date('2026-11-09T00:00:00Z');

describe('parseModelYear', () => {
	it.each([
		['2026 G80 가격표.pdf', '2026'],
		['더 뉴 스타리아 Electric 2027년형', '2027'],
		['the-new-g80_MY26_price.pdf', '2026'],
		['The 2027 K5 가격표', '2027'],
		['GV70 2026 Model Year', '2026'],
		['2026년식 쏘렌토', '2026'],
		['K8_2026_pricelist.pdf', '2026'],
		['2026.11.01 기준 판매가격', null], // bare date is not a model year
		['스타리아 가격표', null],
		['2031년형 미래차', null], // implausibly far ahead
	])('%s → %s', (text, expected) => {
		expect(parseModelYear([text], now)).toBe(expected);
	});

	it('takes the highest year across texts', () => {
		expect(parseModelYear(['2025년형 G80 대비', '2026년형 G80 가격표'], now)).toBe('2026');
	});
});

describe('parseEffectiveDate', () => {
	it.each([
		['2026년 11월 1일 기준', '2026-11-01'],
		['판매가격 (2026.11.01 기준)', '2026-11-01'],
		['2026-09-15 시행', '2026-09-15'],
		['2026. 3. 2부터 적용', '2026-03-02'],
		['2026년 11월 1일', null], // no 기준/시행/적용 cue
		['2026.13.01 기준', null],
	])('%s → %s', (text, expected) => {
		expect(parseEffectiveDate([text])).toBe(expected);
	});
});

describe('family key', () => {
	it.each([
		['더 뉴 G80', 'g80'],
		['G80 2026년형', 'g80'],
		['디 올 뉴 그랜저', '그랜저'],
		['The new Santa Fe', 'santa fe'],
		['G80 전동화', 'g80 전동화'],
		['G80 Electrified', 'g80 전동화'],
		['더 뉴 스타리아 Electric', '스타리아 electric'],
		['스타리아 가격표', '스타리아'],
		['GV80 쿠페', 'gv80 쿠페'],
		['제네시스 G90 2026 가격표.pdf', 'g90'],
	])('%s → %s', (name, expected) => {
		expect(familyName(name)).toBe(expected);
	});

	it('keeps powertrain variants apart and makes years comparable', () => {
		expect(familyKey('hyundai', '스타리아 Electric')).not.toBe(familyKey('hyundai', '스타리아'));
		expect(familyKey('genesis', '2025 G80')).toBe(familyKey('genesis', '더 뉴 G80 2026년형'));
	});
});

describe('identify', () => {
	it('derives keys from a file name and cover text', () => {
		const id = identify({ name: 'G80', filename: 'genesis_G80_2026.pdf', coverText: '2026년 10월 1일 기준 판매가격', now });
		expect(id).toEqual({
			brand: 'genesis',
			name: 'G80',
			modelYear: '2026',
			effectiveDate: '2026-10-01',
			familyKey: 'genesis|g80',
			vehicleKey: 'genesis|g80|2026',
		});
	});

	it('returns null keys when the vehicle name is unknown', () => {
		const id = identify({ filename: 'price_list.pdf', coverText: '현대자동차', now });
		expect(id.brand).toBe('hyundai');
		expect(id.familyKey).toBeNull();
		expect(id.vehicleKey).toBeNull();
	});

	it('guesses Genesis from model codes', () => {
		expect(guessBrand(['GV70 가격표'])).toBe('genesis');
	});
});
