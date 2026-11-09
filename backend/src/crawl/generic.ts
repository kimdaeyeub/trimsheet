// Find price-sheet PDFs on an arbitrary manufacturer page (PLAN.md Phase 5.3).
import { parseModelYear } from '../pipeline/identity.ts';
import { genesisPdfUrl } from './fetch-pdf.ts';
import { CAPTURE_SCRIPT, withPage } from './browser.ts';

export interface RawLink {
	href: string;
	text: string;
}

export interface Candidate {
	url: string;
	label: string;
	guessKind: 'pricesheet' | 'catalog' | 'unknown';
	modelYear: string | null;
}

const ARCHIVE = /지난|이전|과거|archive|old/i;

export function guessKind(href: string, text: string): Candidate['guessKind'] {
	const s = `${href} ${text}`;
	if (/가격표|가격|price|pricelist/i.test(s) && !/카탈로그|catalog/i.test(text)) return 'pricesheet';
	if (/카탈로그|catalog|brochure/i.test(s)) return 'catalog';
	return 'unknown';
}

/** Normalise, dedupe and rank links; drop archive links and non-PDFs. */
export function classifyLinks(raw: RawLink[], pageUrl: string): { candidates: Candidate[]; dropped: { url: string; reason: string }[] } {
	const out = new Map<string, Candidate>();
	const dropped: { url: string; reason: string }[] = [];
	for (const { href, text } of raw) {
		let url: string;
		const genesis = /viewPdf\('([A-Z0-9]+)','([^']+\.pdf)'/.exec(href);
		if (genesis) url = genesisPdfUrl(genesis[1]);
		else {
			try {
				url = new URL(href, pageUrl).toString();
			} catch {
				continue;
			}
			if (!/\.pdf($|\?)/i.test(url)) continue;
		}
		const label = text.replace(/\s+/g, ' ').trim() || decodeURIComponent(url.split('/').pop() ?? '');
		if (ARCHIVE.test(label)) {
			dropped.push({ url, reason: '이전/지난 가격표 링크' });
			continue;
		}
		const fileHint = genesis ? genesis[2] : url;
		if (!out.has(url)) out.set(url, { url, label, guessKind: guessKind(fileHint, label), modelYear: parseModelYear([label, fileHint]) });
	}
	const order = { pricesheet: 0, unknown: 1, catalog: 2 } as const;
	return { candidates: [...out.values()].sort((a, b) => order[a.guessKind] - order[b.guessKind]), dropped };
}

/** Among price sheets that state a model year, keep only the newest year. */
export function keepLatestYear(cands: Candidate[]): { candidates: Candidate[]; dropped: { url: string; reason: string }[] } {
	const years = cands.filter((c) => c.guessKind === 'pricesheet' && c.modelYear).map((c) => c.modelYear!);
	const top = years.sort().at(-1);
	if (!top) return { candidates: cands, dropped: [] };
	const dropped = cands.filter((c) => c.guessKind === 'pricesheet' && c.modelYear && c.modelYear < top).map((c) => ({ url: c.url, reason: `이전 연식 (최신: ${top}년형)` }));
	const droppedUrls = new Set(dropped.map((d) => d.url));
	return { candidates: cands.filter((c) => !droppedUrls.has(c.url)), dropped };
}

/** Render the page, collect PDF links, click up to three "가격표" buttons and capture what they open. */
export async function findPdfLinksInBrowser(browser: BrowserRun, url: string): Promise<RawLink[]> {
	return withPage(browser, async (page) => {
		await page.addInitScript(CAPTURE_SCRIPT);
		await page.goto(url, { waitUntil: 'domcontentloaded' });
		await page.waitForTimeout(2_500);
		const anchors = await page.$$eval('a[href]', (as) =>
			as.map((a) => ({ href: a.getAttribute('href') ?? '', text: a.textContent ?? '' })),
		);
		const buttons = page.locator('a, button').filter({ hasText: /^\s*(가격표|가격표 다운로드|가격표 보기)\s*$/ });
		const n = Math.min(await buttons.count(), 3);
		for (let i = 0; i < n; i++) {
			await buttons.nth(i).click({ timeout: 5_000 }).catch(() => undefined);
			await page.waitForTimeout(800);
		}
		const captured = await page.evaluate(() => (globalThis as unknown as { __trimsheetCapture?: string[] }).__trimsheetCapture ?? []);
		return [...anchors, ...captured.map((href) => ({ href, text: '가격표' }))];
	});
}
