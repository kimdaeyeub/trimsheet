import { describe, expect, it } from 'vitest';
import { itemKey, normName, parsePrice, sameSet } from '../src/pipeline/normalize.ts';

describe('parsePrice', () => {
	it.each([
		['41,250,000원', 41_250_000],
		['41,250,000', 41_250_000],
		['41250000원', 41_250_000],
		['4,125만원', 41_250_000],
		['4125만', 41_250_000],
		['4,125.5만원', 41_255_000],
		[' 1,200,000 원 ', 1_200_000],
		['１,２００,０００원', 1_200_000], // full-width digits
		['+ 900,000원', 900_000],
		['0원', 0],
		['기본 적용', null],
		['', null],
	])('%s → %s', (input, expected) => {
		expect(parsePrice(input)).toBe(expected);
	});
});

describe('normName / keys', () => {
	it('normalises width, brackets, dots and spaces', () => {
		expect(normName('  카고 ３인승　2WD【오토】 ')).toBe('카고 3인승 2wd[오토]');
		expect(normName('익스테리어ㆍ디자인')).toBe(normName('익스테리어·디자인'));
	});

	it('compares target sets order-insensitively', () => {
		expect(sameSet(['A', 'b '], ['B', 'a'])).toBe(true);
		expect(sameSet(['A'], ['A', 'B'])).toBe(false);
		expect(itemKey.rule({ type: 'exclusive', subject: 'X', targets: ['B', 'a'] })).toBe(
			itemKey.rule({ type: 'exclusive', subject: 'x', targets: ['A', 'b'] }),
		);
	});
});
