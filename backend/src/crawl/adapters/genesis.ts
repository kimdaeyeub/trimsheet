// Genesis: the download centre is plain HTML (no browser needed). PDFs are fetched by POSTing
// a file key; older files of the same model stay listed, so keep the newest per slug.
// Evidence: docs/site-notes.md (제네시스).
import { genesisPdfUrl } from '../fetch-pdf.ts';
import type { ListResult, PdfRef } from '../types.ts';

export const GENESIS = {
	pageUrl: 'https://www.genesis.com/kr/ko/support/download-center/genesis-models.html',
};

const ANCHOR = /<a\b[^>]*href="javascript:viewPdf\('([A-Z0-9]+)','(genesis-([a-z0-9-]+?)-pricelist-kor-(\d{6})\.pdf)','[A-Z_]+'\)"[^>]*>([\s\S]*?)<\/a>/g;

const textOf = (html: string) =>
	html
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;|&#160;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();

/** "PDF G90 Long Wheel Base 가격표" → "G90 Long Wheel Base" */
const cleanName = (s: string) => s.replace(/^PDF\s*/i, '').replace(/\s*가격표\s*$/, '').trim();

export function parseGenesisHtml(html: string): ListResult {
	const latest = new Map<string, PdfRef>();
	const skipped: ListResult['skipped'] = [];
	for (const m of html.matchAll(ANCHOR)) {
		const [, fileKey, filename, slug, ym, inner] = m;
		const name = cleanName(textOf(inner)) || slug.toUpperCase();
		const ref: PdfRef = { brand: 'genesis', vehicleName: name, url: genesisPdfUrl(fileKey), method: 'POST', form: { file_key: fileKey }, filename, publishedYm: ym, siteKey: slug };
		const cur = latest.get(slug);
		if (!cur) latest.set(slug, ref);
		else if (ym > cur.publishedYm!) {
			skipped.push({ vehicleName: `${cur.vehicleName} (${cur.publishedYm})`, reason: `이전 가격표 (최신 ${ym})` });
			latest.set(slug, ref);
		} else if (ym < cur.publishedYm!) skipped.push({ vehicleName: `${name} (${ym})`, reason: `이전 가격표 (최신 ${cur.publishedYm})` });
	}
	return { refs: [...latest.values()], skipped };
}

export async function listGenesis(signal?: AbortSignal): Promise<ListResult> {
	const res = await fetch(GENESIS.pageUrl, { signal, headers: { 'accept-language': 'ko-KR,ko;q=0.9' } });
	if (!res.ok) return { refs: [], skipped: [], failure: `접속 실패 (HTTP ${res.status})` };
	const result = parseGenesisHtml(await res.text());
	if (result.refs.length === 0) return { ...result, failure: '사이트 구조 변경 의심 (제네시스 다운로드 센터에서 가격표를 찾지 못함)' };
	return result;
}
