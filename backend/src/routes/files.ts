import { Hono } from 'hono';
import { AppError } from '../shared/errors.ts';
import { keys } from '../store/r2.ts';

export const files = new Hono<{ Bindings: Env }>();

// Only content-addressed PDFs are served; the key is never taken verbatim from the URL.
files.get('/pdf/:name', async (c) => {
	const match = /^([0-9a-f]{64})\.pdf$/.exec(c.req.param('name'));
	if (!match) throw new AppError('not_found', '파일을 찾을 수 없습니다.', 404);

	const obj = await c.env.FILES.get(keys.pdf(match[1]));
	if (!obj) throw new AppError('not_found', '파일을 찾을 수 없습니다.', 404);

	const filename = decodeURIComponent(obj.customMetadata?.filename ?? `${match[1]}.pdf`);
	const headers = new Headers({
		'content-type': 'application/pdf',
		'content-length': String(obj.size),
		etag: obj.httpEtag,
		'cache-control': 'private, max-age=0',
		'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
	});
	// Stream straight from R2 — never buffer the whole PDF in the Worker.
	return new Response(obj.body, { headers });
});
