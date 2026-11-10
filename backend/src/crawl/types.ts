import type { Brand } from '@shared/types';

/**
 * Sent on every request to manufacturer sites. Workers' fetch adds no User-Agent, and the Genesis
 * download endpoint answers a request without one with 200 and an empty body (2026-11-10).
 */
export const CRAWLER_HEADERS = {
	'user-agent': 'Mozilla/5.0 (compatible; TrimSheet/1.0; personal price-sheet reader)',
	'accept-language': 'ko-KR,ko;q=0.9',
} as const;

/** A price-sheet PDF found on a manufacturer site. */
export interface PdfRef {
	brand: Brand;
	/** Display name from the site (e.g. "더 뉴 스타리아 Electric"). */
	vehicleName: string;
	/** Canonical URL recorded in PDF목록 (for POST downloads: the endpoint + `?file_key=`). */
	url: string;
	/** How to fetch the bytes. */
	method: 'GET' | 'POST';
	form?: Record<string, string>;
	/** Site-side file name, when known. */
	filename?: string;
	/** Publication month from the file name (Genesis), "YYYYMM". */
	publishedYm?: string;
	/** Stable per-vehicle key on the site (slug), used to keep only the newest file. */
	siteKey: string;
}

export interface ListResult {
	refs: PdfRef[];
	/** Entries deliberately skipped (commercial vehicles, older files) with reasons. */
	skipped: { vehicleName: string; reason: string }[];
	failure?: string;
}

/** Commercial / special-purpose vehicles are out of scope (PLAN.md §12). */
const COMMERCIAL = /포터|봉고|트럭|덤프|탑차|윙바디|워크스루|파워게이트|냉동|특장|택시|카고|오픈베드|WAV|그랜버드|버스|카운티|쏠라티|유니버스|마이티|파비스|엑시언트|ST1/i;

export const isCommercial = (name: string) => COMMERCIAL.test(name);
