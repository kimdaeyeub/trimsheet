// Hyundai: render the full line-up page, derive each price-sheet URL from the vehicle slug.
// Evidence: docs/site-notes.md (현대).
import { withPage } from '../browser.ts';
import { isCommercial, type ListResult, type PdfRef } from '../types.ts';

export const HYUNDAI = {
	lineupUrl: 'https://www.hyundai.com/kr/ko/e/all-vehicles',
	cardSelector: 'a[href*="/kr/ko/e/vehicles/"][href$="/intro"]',
	priceUrl: (slug: string) => `https://www.hyundai.com/contents/repn-car/catalog/${slug}_price.pdf`,
};

export interface RawCard {
	href: string;
	text: string;
}

/** "NEW 디 올 뉴 투싼 3,140만원~ N line포함" → "디 올 뉴 투싼" */
export function cleanHyundaiName(text: string): string {
	return text
		.replace(/\s+/g, ' ')
		.replace(/^NEW\s+/i, '')
		.replace(/\d{1,3}(?:,\d{3})*\s*만원~?/g, '')
		.replace(/N\s*line\s*포함/gi, '')
		.trim();
}

export function parseHyundaiCards(raw: RawCard[]): ListResult {
	const bySlug = new Map<string, string>();
	for (const { href, text } of raw) {
		const slug = /\/vehicles\/([a-z0-9-]+)\/intro/.exec(href)?.[1];
		const name = cleanHyundaiName(text);
		if (!slug || !name || name === '자세히 보기' || name === '내 차 만들기') continue;
		if (!bySlug.has(slug)) bySlug.set(slug, name);
	}
	const refs: PdfRef[] = [];
	const skipped: ListResult['skipped'] = [];
	for (const [slug, name] of bySlug) {
		if (isCommercial(name)) {
			skipped.push({ vehicleName: name, reason: '상용·특장차' });
			continue;
		}
		refs.push({ brand: 'hyundai', vehicleName: name, url: HYUNDAI.priceUrl(slug), method: 'GET', siteKey: slug, filename: `${slug}_price.pdf` });
	}
	return { refs, skipped };
}

export async function listHyundai(browser: BrowserRun): Promise<ListResult> {
	return withPage(browser, async (page) => {
		await page.goto(HYUNDAI.lineupUrl, { waitUntil: 'domcontentloaded' });
		await page.waitForSelector(HYUNDAI.cardSelector, { timeout: 20_000 });
		const raw = await page.$$eval(HYUNDAI.cardSelector, (as) =>
			as.map((a) => ({ href: a.getAttribute('href') ?? '', text: a.textContent ?? '' })),
		);
		const result = parseHyundaiCards(raw);
		if (result.refs.length === 0) return { ...result, failure: '사이트 구조 변경 의심 (현대 라인업에서 차종을 찾지 못함)' };
		return result;
	});
}
