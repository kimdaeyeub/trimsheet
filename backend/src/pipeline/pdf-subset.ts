// Copy only relevant pages into a smaller PDF for the OpenAI fallback (PLAN.md §7.4).
import { PDFDocument } from 'pdf-lib';

/** Flue document input limit is 14 MiB of base64; stay well under it. */
export const MAX_DOCUMENT_BASE64 = 12 * 1024 * 1024;
export const MAX_DOCUMENT_PAGES = 100;

export const base64Length = (byteLength: number) => Math.ceil(byteLength / 3) * 4;

export function needsSubset(byteLength: number, pageCount: number): boolean {
	return base64Length(byteLength) > MAX_DOCUMENT_BASE64 || pageCount > MAX_DOCUMENT_PAGES;
}

/** Relevant pages plus one page of context on each side, within bounds, sorted. */
export function withNeighbours(pages: Iterable<number>, pageCount: number): number[] {
	const out = new Set<number>();
	for (const p of pages) for (const q of [p - 1, p, p + 1]) if (q >= 1 && q <= pageCount) out.add(q);
	return [...out].sort((a, b) => a - b);
}

export interface Subset {
	bytes: Uint8Array;
	/** originalPages[i] is the original page number of subset page i + 1. */
	originalPages: number[];
}

export async function subsetPdf(bytes: ArrayBuffer, originalPages: number[]): Promise<Subset> {
	const src = await PDFDocument.load(bytes);
	const out = await PDFDocument.create();
	const copied = await out.copyPages(src, originalPages.map((p) => p - 1));
	for (const page of copied) out.addPage(page);
	return { bytes: await out.save(), originalPages };
}

/** Subset page number (1-based) → original page number. Unknown pages pass through. */
export function remapPage(page: number, originalPages: readonly number[]): number {
	return originalPages[page - 1] ?? page;
}

/** Prompt note telling the model how subset pages map to the original. */
export function subsetNote(originalPages: readonly number[]): string {
	return `이 문서는 원본에서 일부 페이지만 뽑은 것입니다. 페이지 대응: ${originalPages
		.map((orig, i) => `${i + 1}→p.${orig}`)
		.join(', ')}. evidence.page에는 **원본 페이지 번호**를 쓰세요.`;
}

export function toBase64(bytes: Uint8Array): string {
	let bin = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
	return btoa(bin);
}
