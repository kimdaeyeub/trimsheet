// Does the quoted evidence actually appear on the cited page? (PLAN.md §7.6)
import { compact } from './normalize.ts';

const trigrams = (s: string) => {
	const set = new Set<string>();
	for (let i = 0; i + 3 <= s.length; i++) set.add(s.slice(i, i + 3));
	return set;
};

/** Best Jaccard similarity of the quote's trigrams against any same-length window of the page. */
function fuzzyContains(page: string, quote: string): number {
	if (quote.length < 3 || page.length < quote.length) return 0;
	const q = trigrams(quote);
	let best = 0;
	const step = Math.max(1, Math.floor(quote.length / 4));
	for (let i = 0; i + quote.length <= page.length; i += step) {
		const w = trigrams(page.slice(i, i + quote.length));
		let inter = 0;
		for (const g of q) if (w.has(g)) inter++;
		const jac = inter / (q.size + w.size - inter);
		if (jac > best) best = jac;
		if (best === 1) break;
	}
	return best;
}

export interface PageLookup {
	get(page: number): string | undefined;
}

export function pageLookup(pages: readonly { page: number; text: string }[]): PageLookup {
	const m = new Map(pages.map((p) => [p.page, compact(p.text)]));
	return { get: (n) => m.get(n) };
}

/** True when the quote is on page ±1 (exact after normalisation, or ≥ 0.8 trigram similarity). */
export function verifyQuote(pages: PageLookup, page: number, quote: string): boolean {
	const q = compact(quote);
	if (!q) return false;
	for (const n of [page, page - 1, page + 1]) {
		const text = pages.get(n);
		if (!text) continue;
		if (text.includes(q)) return true;
		if (fuzzyContains(text, q) >= 0.8) return true;
	}
	return false;
}
