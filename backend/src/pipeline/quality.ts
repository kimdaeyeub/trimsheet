// Is a pass result good enough, or should it be retried with the fallback model? (F4, PLAN.md §6.2)
import { FALLBACK } from '../shared/config.ts';
import { verifyQuote, type PageLookup } from './evidence.ts';
import type { Extraction } from './schema.ts';

export interface QualityReport {
	ok: boolean;
	reason?: string;
	evidenceMissRate: number;
	itemCount: number;
}

export function checkQuality(ex: Extraction, ctx: { looksLikePriceSheet: boolean; pages: PageLookup | null }): QualityReport {
	const items = [...ex.trims, ...ex.colors, ...ex.options, ...ex.rules];
	let misses = 0;
	if (ctx.pages) for (const it of items) if (!verifyQuote(ctx.pages, it.evidence.page, it.evidence.quote)) misses++;
	const evidenceMissRate = ctx.pages && items.length ? misses / items.length : 0;

	if (ctx.looksLikePriceSheet && ex.document.isPriceSheet && ex.trims.length === 0) {
		return { ok: false, reason: '가격표로 보이는데 트림을 하나도 찾지 못함', evidenceMissRate, itemCount: items.length };
	}
	if (ctx.looksLikePriceSheet && !ex.document.isPriceSheet) {
		return { ok: false, reason: '구조상 가격표로 보이는데 모델은 가격표가 아니라고 판단', evidenceMissRate, itemCount: items.length };
	}
	if (evidenceMissRate > FALLBACK.maxEvidenceMissRate) {
		return {
			ok: false,
			reason: `근거 원문 불일치 비율 ${(evidenceMissRate * 100).toFixed(0)}%`,
			evidenceMissRate,
			itemCount: items.length,
		};
	}
	return { ok: true, evidenceMissRate, itemCount: items.length };
}
