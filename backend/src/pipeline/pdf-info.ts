import { getDocumentProxy } from 'unpdf';

export const MAX_PDF_BYTES = 50 * 1024 * 1024;

/** `%PDF-` magic bytes at the start of the file. */
export function looksLikePdf(bytes: ArrayBuffer): boolean {
	const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
	return String.fromCharCode(...head) === '%PDF-';
}

/** Page count, or null when pdf.js cannot open the file. */
export async function pdfPageCount(bytes: ArrayBuffer): Promise<number | null> {
	try {
		// pdf.js may detach the buffer it is given, so hand it a copy.
		const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
		const pages = pdf.numPages;
		await pdf.cleanup();
		return pages;
	} catch {
		return null;
	}
}
