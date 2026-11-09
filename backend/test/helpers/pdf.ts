import { PDFDocument, StandardFonts } from 'pdf-lib';

/** A small valid PDF with `pages` pages and some ASCII text on each. */
export async function makePdf(pages = 2, label = 'TrimSheet test'): Promise<ArrayBuffer> {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	for (let i = 1; i <= pages; i++) {
		const page = doc.addPage([400, 300]);
		page.drawText(`${label} page ${i}`, { x: 40, y: 250, size: 14, font });
	}
	const bytes = await doc.save();
	return bytes.slice().buffer;
}
