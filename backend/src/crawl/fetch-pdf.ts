// Download / probe PDFs for crawled refs (GET links and Genesis' POST endpoint).
import { MAX_PDF_BYTES, looksLikePdf } from '../pipeline/pdf-info.ts';
import { AppError } from '../shared/errors.ts';
import type { PdfRef } from './types.ts';

const GENESIS_PDFVIEW = 'https://www.genesis.com/wsvc/kr/api/v2/download-center/pdfview';

export const genesisPdfUrl = (fileKey: string) => `${GENESIS_PDFVIEW}?file_key=${encodeURIComponent(fileKey)}`;

/** Turn a recorded URL back into a request (Genesis POST URLs carry the key as a query param). */
export function requestFor(url: string): { url: string; method: 'GET' | 'POST'; form?: Record<string, string> } {
	const u = new URL(url);
	if (`${u.origin}${u.pathname}` === GENESIS_PDFVIEW && u.searchParams.get('file_key')) {
		return { url: GENESIS_PDFVIEW, method: 'POST', form: { file_key: u.searchParams.get('file_key')! } };
	}
	return { url, method: 'GET' };
}

export interface Downloaded {
	bytes: ArrayBuffer;
	etag: string;
	lastModified: string;
	filename: string;
}

function filenameFrom(res: Response, fallbackUrl: string, hint?: string): string {
	const cd = res.headers.get('content-disposition') ?? '';
	const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
	if (star) return decodeURIComponent(star[1]);
	const plain = /filename="?([^";]+)"?/i.exec(cd);
	if (plain) return plain[1];
	if (hint) return hint;
	return decodeURIComponent(new URL(res.url || fallbackUrl).pathname.split('/').pop() || 'price.pdf');
}

export async function downloadPdf(ref: Pick<PdfRef, 'url' | 'filename'>, signal?: AbortSignal): Promise<Downloaded> {
	const req = requestFor(ref.url);
	const res = await fetch(req.url, {
		method: req.method,
		redirect: 'follow',
		signal,
		...(req.form ? { body: new URLSearchParams(req.form), headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}),
	});
	if (!res.ok) throw new AppError('download_failed', `다운로드 실패 (HTTP ${res.status})`);
	if (Number(res.headers.get('content-length') ?? 0) > MAX_PDF_BYTES) throw new AppError('too_large', 'PDF가 50MB를 넘습니다.');
	const bytes = await res.arrayBuffer();
	if (bytes.byteLength > MAX_PDF_BYTES) throw new AppError('too_large', 'PDF가 50MB를 넘습니다.');
	if (!looksLikePdf(bytes)) throw new AppError('not_pdf', '링크의 파일이 PDF가 아닙니다.');
	return {
		bytes,
		etag: res.headers.get('etag') ?? '',
		lastModified: res.headers.get('last-modified') ?? '',
		filename: filenameFrom(res, ref.url, ref.filename),
	};
}

/**
 * L1 probe without downloading. GET links: HEAD for ETag/Last-Modified.
 * POST (Genesis): the file key changes with every new file, so the URL itself is the fingerprint.
 */
export async function probe(url: string, signal?: AbortSignal): Promise<{ etag: string; lastModified: string; exists: boolean } | null> {
	const req = requestFor(url);
	if (req.method === 'POST') return null;
	const res = await fetch(req.url, { method: 'HEAD', redirect: 'follow', signal });
	await res.body?.cancel();
	return { exists: res.ok, etag: res.headers.get('etag') ?? '', lastModified: res.headers.get('last-modified') ?? '' };
}

/** Unchanged when the URL is the same and the server fingerprint matches (or the URL is itself a fingerprint). */
export function unchanged(known: { etag?: string; lastModified?: string } | null, probed: { etag: string; lastModified: string } | null): boolean {
	if (!known) return false;
	if (probed === null) return true; // POST refs: same URL = same file
	return Boolean((probed.etag && probed.etag === known.etag) || (probed.lastModified && probed.lastModified === known.lastModified));
}
