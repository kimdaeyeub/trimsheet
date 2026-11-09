import { Hono } from 'hono';
import type { UploadResponse } from '@shared/types';
import { MAX_PDF_BYTES, looksLikePdf, pdfPageCount } from '../pipeline/pdf-info.ts';
import { getRepo } from '../sheets/index.ts';
import { AppError } from '../shared/errors.ts';
import { sha256Hex, sourceIdFromSha } from '../shared/ids.ts';
import { log } from '../shared/log.ts';
import { keys, putPdf } from '../store/r2.ts';

export const uploads = new Hono<{ Bindings: Env }>();

uploads.post('/', async (c) => {
	const declared = Number(c.req.header('content-length') ?? 0);
	if (declared > MAX_PDF_BYTES + 64 * 1024) throw new AppError('too_large', 'PDF는 50MB 이하만 올릴 수 있습니다.', 413);

	const form = await c.req.formData();
	const file = form.get('file');
	if (!(file instanceof File)) throw new AppError('missing_file', '`file` 필드에 PDF를 첨부하세요.');
	if (file.size > MAX_PDF_BYTES) throw new AppError('too_large', 'PDF는 50MB 이하만 올릴 수 있습니다.', 413);

	const bytes = await file.arrayBuffer();
	if (!looksLikePdf(bytes)) throw new AppError('not_pdf', 'PDF 파일이 아닙니다.', 415);
	const pageCount = await pdfPageCount(bytes);
	if (pageCount === null) throw new AppError('broken_pdf', 'PDF를 열 수 없습니다. 파일이 손상되었는지 확인하세요.', 422);

	const sha256 = await sha256Hex(bytes);
	const sourceId = sourceIdFromSha(sha256);
	const filename = file.name || `${sourceId}.pdf`;

	const storedNew = await putPdf(c.env.FILES, sha256, bytes, { filename, origin: 'upload' });
	const addedRow = await getRepo(c.env).addPdfSourceIfNew({
		sourceId,
		origin: 'upload',
		filename,
		pdfKey: keys.pdf(sha256),
		sha256,
		sizeBytes: bytes.byteLength,
		pageCount,
		kind: 'unknown',
	});
	log('info', 'pdf_uploaded', { sourceId, sizeBytes: bytes.byteLength, pageCount, storedNew, addedRow });

	return c.json<UploadResponse>(
		{ sourceId, filename, pageCount, sizeBytes: bytes.byteLength, alreadyKnown: !storedNew || !addedRow },
		storedNew ? 201 : 200,
	);
});
