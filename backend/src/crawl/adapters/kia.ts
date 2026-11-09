// Kia: one catalog/price page with category tabs; each card links its price-sheet PDF.
// Evidence: docs/site-notes.md (기아).
import { withPage } from '../browser.ts';
import { isCommercial, type ListResult, type PdfRef } from '../types.ts';

export const KIA = {
	pageUrl: 'https://www.kia.com/kr/vehicles/catalog-price',
	tabSelector: 'a.vehicis-cate__link',
	cardSelector: '.vc-card__wrap',
	priceLinkSelector: 'a[href*="/pdf/price/"]',
	/** Whole tab skipped: taxis and commercial vehicles. */
	skipTabs: ['택시 & 상용'],
	origin: 'https://www.kia.com',
};

export interface KiaCard {
	tab: string;
	name: string;
	href: string | null;
}

export function parseKiaCards(cards: KiaCard[]): ListResult {
	const refs: PdfRef[] = [];
	const skipped: ListResult['skipped'] = [];
	const seen = new Set<string>();
	for (const c of cards) {
		const name = c.name.replace(/카탈로그|가격표/g, '').replace(/\s+/g, ' ').trim();
		if (!name) continue;
		if (KIA.skipTabs.includes(c.tab) || isCommercial(name)) {
			skipped.push({ vehicleName: name, reason: '상용·택시' });
			continue;
		}
		if (!c.href) {
			skipped.push({ vehicleName: name, reason: '가격표 링크 없음' });
			continue;
		}
		const url = new URL(c.href, KIA.origin).toString();
		if (seen.has(url)) continue; // several cards can share one PDF
		seen.add(url);
		const slug = /price_([a-z0-9-]+)\.pdf/.exec(url)?.[1] ?? url;
		refs.push({ brand: 'kia', vehicleName: name, url, method: 'GET', siteKey: slug, filename: url.split('/').pop() });
	}
	return { refs, skipped };
}

export async function listKia(browser: BrowserRun): Promise<ListResult> {
	return withPage(browser, async (page) => {
		await page.goto(KIA.pageUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector(KIA.tabSelector, { timeout: 20_000 });
		const tabs = await page.$$eval(KIA.tabSelector, (as) => as.map((a) => (a.textContent ?? '').trim()));
		const cards: KiaCard[] = [];
		for (const [i, tab] of tabs.entries()) {
			if (KIA.skipTabs.includes(tab)) continue;
			await page.locator(KIA.tabSelector).nth(i).click();
			await page.waitForTimeout(1_200);
			const found = await page.$$eval(
				KIA.cardSelector,
				(els, linkSel) =>
					els.map((el) => ({
						name: el.textContent ?? '',
						href: el.querySelector(linkSel)?.getAttribute('href') ?? null,
					})),
				KIA.priceLinkSelector,
			);
			cards.push(...found.map((f) => ({ ...f, tab })));
		}
		const result = parseKiaCards(cards);
		if (result.refs.length === 0) return { ...result, failure: '사이트 구조 변경 의심 (기아 카탈로그/가격표에서 차종을 찾지 못함)' };
		return result;
	});
}
