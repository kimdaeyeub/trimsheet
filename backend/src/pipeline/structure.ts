// Where is what in the price sheet? Keyword scoring per page (PLAN.md §7.3). Hints only.
import type { PageMap } from '@shared/types';
import { FALLBACK } from '../shared/config.ts';

const KEYWORDS = {
	price: [/판매\s*가격/, /가격/, /트림/, /기본\s*품목/],
	color: [/컬러/, /색상/, /외장/, /내장/],
	option: [/선택\s*품목/, /옵션/, /패키지/],
	footnote: [/※/, /^\s*\*/m, /주\)/],
} as const;

const AMOUNT = /\d{1,3}(?:,\d{3})+/g;

export interface Structure {
	pageMap: PageMap;
	isScanned: boolean;
	looksLikePriceSheet: boolean;
	avgCharsPerPage: number;
}

export function analyzeStructure(pages: readonly { page: number; text: string }[]): Structure {
	const map: PageMap = { cover: [], price: [], color: [], option: [], footnote: [], other: [] };
	let amounts = 0;
	for (const { page, text } of pages) {
		if (page === 1) map.cover.push(page);
		const pageAmounts = text.match(AMOUNT)?.length ?? 0;
		amounts += pageAmounts;
		const hits = (k: keyof typeof KEYWORDS) => KEYWORDS[k].filter((re) => re.test(text)).length;
		let tagged = false;
		if (hits('price') >= 1 && pageAmounts >= 3) (map.price.push(page), (tagged = true));
		if (hits('color') >= 2) (map.color.push(page), (tagged = true));
		if (hits('option') >= 1 && pageAmounts >= 1) (map.option.push(page), (tagged = true));
		if (hits('footnote') >= 1) (map.footnote.push(page), (tagged = true));
		if (!tagged && page !== 1) map.other.push(page);
	}
	const chars = pages.map((p) => p.text.replace(/\s/g, '').length);
	const avgCharsPerPage = pages.length ? chars.reduce((a, b) => a + b, 0) / pages.length : 0;
	// Scanned = (almost) every page lacks a text layer. A few short pages (cover, notices) are normal.
	const blankPages = chars.filter((n) => n < FALLBACK.minTextCharsPerPage / 2).length;
	return {
		pageMap: map,
		isScanned: pages.length === 0 || blankPages / pages.length >= 0.8,
		looksLikePriceSheet: map.price.length >= 1 && amounts >= 5,
		avgCharsPerPage: Math.round(avgCharsPerPage),
	};
}

/** Pages worth sending to the model for a section, plus the cover (vehicle name, year, date). */
export function relevantPages(map: PageMap, section: 'trimsColors' | 'options' | 'rules'): Set<number> {
	const pick = {
		trimsColors: [...map.cover, ...map.price, ...map.color],
		options: [...map.option, ...map.price],
		rules: [...map.option, ...map.footnote, ...map.price],
	}[section];
	return new Set(pick);
}
