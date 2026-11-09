import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { classifyLinks, findPdfLinksInBrowser, keepLatestYear, type RawLink } from '../crawl/generic.ts';
import { log as jlog } from '../shared/log.ts';
import { deps, next } from './common.ts';
import { checkUrl } from './register-pdf-url.ts';

/** Anchors straight from HTML — enough for server-rendered pages such as Genesis' download centre. */
export function anchorsFromHtml(html: string): RawLink[] {
	const out: RawLink[] = [];
	for (const m of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
		out.push({ href: m[1].replaceAll('&amp;', '&'), text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() });
	}
	return out;
}

export const findPdfsOnPage = defineTool({
	name: 'find_pdfs_on_page',
	description:
		'현대·기아·제네시스 차종 페이지(또는 카탈로그/가격표 페이지) URL에서 가격표 PDF 후보를 찾습니다. 이전 연식·지난 가격표는 빼고 최신만 돌려줍니다. 가격표 후보가 하나면 nextStep(register_pdf_url)을 호출하고, 여러 개면 사용자에게 고르게 하세요.',
	input: v.object({ url: v.pipe(v.string(), v.url()), conversationId: v.optional(v.string()) }),
	timeoutMs: 120_000,
	async run({ data, log, signal }) {
		const url = checkUrl(data.url).toString();
		const { env, repo } = deps();
		let raw: RawLink[] = [];
		let failure: string | null = null;
		try {
			// Plain HTML first (free); render with Browser Run only when the page needs JavaScript.
			const res = await fetch(url, { signal, headers: { 'accept-language': 'ko-KR,ko;q=0.9' } });
			if (res.ok) raw = anchorsFromHtml(await res.text());
			if (!classifyLinks(raw, url).candidates.length) {
				log.info('페이지를 브라우저로 여는 중');
				raw = await findPdfLinksInBrowser(env.BROWSER, url);
			}
		} catch (err) {
			failure = '접속 실패';
			jlog('warn', 'find_pdfs_failed', { url, message: err instanceof Error ? err.message : String(err) });
		}

		const classified = classifyLinks(raw, url);
		const latest = keepLatestYear(classified.candidates);
		const dropped = [...classified.dropped, ...latest.dropped];
		const candidates = await Promise.all(
			latest.candidates.slice(0, 10).map(async (c) => ({ ...c, alreadyKnown: Boolean(await repo.findPdfSourceByUrl(c.url)) })),
		);
		if (!failure && candidates.length === 0) failure = raw.length ? '링크 없음' : '사이트 구조 변경 의심';

		const priceSheets = candidates.filter((c) => c.guessKind === 'pricesheet');
		return {
			output: {
				candidates,
				dropped,
				failure,
				nextStep:
					priceSheets.length === 1
						? next('register_pdf_url', { url: priceSheets[0].url, ...(data.conversationId ? { conversationId: data.conversationId } : {}) })
						: null,
			},
		};
	},
});
