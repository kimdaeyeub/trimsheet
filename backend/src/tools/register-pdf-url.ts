import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { MAX_PDF_BYTES, looksLikePdf, pdfPageCount } from '../pipeline/pdf-info.ts';
import { AppError } from '../shared/errors.ts';
import { sha256Hex, sourceIdFromSha } from '../shared/ids.ts';
import { keys, putPdf } from '../store/r2.ts';
import { deps, next } from './common.ts';

const ALLOWED_HOSTS = ['hyundai.com', 'kia.com', 'genesis.com'];

export function checkUrl(raw: string): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new AppError('bad_url', '올바른 URL이 아닙니다.');
	}
	if (url.protocol !== 'https:') throw new AppError('bad_url', 'https 주소만 받을 수 있습니다.');
	const host = url.hostname.toLowerCase();
	if (!ALLOWED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
		throw new AppError('host_not_allowed', '현대·기아·제네시스 공식 사이트(hyundai.com, kia.com, genesis.com)의 PDF만 받을 수 있습니다. 다른 곳의 파일은 직접 올려 주세요.');
	}
	return url;
}

export const registerPdfUrl = defineTool({
	name: 'register_pdf_url',
	description:
		'가격표 PDF의 직접 링크(https, hyundai.com/kia.com/genesis.com)를 내려받아 등록합니다. 이미 받은 파일이면 다시 받지 않습니다. 결과의 nextStep을 이어서 호출하세요.',
	input: v.object({ url: v.pipe(v.string(), v.url()), conversationId: v.optional(v.string()) }),
	durable: true,
	timeoutMs: 60_000,
	async run({ data, step, log, signal }) {
		const url = checkUrl(data.url).toString();
		const { bucket, repo } = deps();

		// L1: same URL with unchanged ETag/Last-Modified → no download.
		const known = await repo.findPdfSourceByUrl(url);
		if (known) {
			const head = await step.do('head', async () => {
				const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal });
				return { etag: res.headers.get('etag') ?? '', lastModified: res.headers.get('last-modified') ?? '' };
			});
			const unchanged = (head.etag && head.etag === known.etag) || (head.lastModified && head.lastModified === known.lastModified);
			if (unchanged) {
				log.info('같은 URL, 변경 없음 — 다운로드 생략');
				return {
					output: {
						sourceId: known.sourceId,
						filename: known.filename,
						alreadyKnown: true,
						nextStep: next('prepare_source', { sourceId: known.sourceId, ...(data.conversationId ? { conversationId: data.conversationId } : {}) }),
					},
				};
			}
		}

		const saved = await step.do('download', async () => {
			const res = await fetch(url, { redirect: 'follow', signal });
			if (!res.ok) throw new AppError('download_failed', `다운로드 실패 (HTTP ${res.status})`);
			const declared = Number(res.headers.get('content-length') ?? 0);
			if (declared > MAX_PDF_BYTES) throw new AppError('too_large', 'PDF가 50MB를 넘습니다.');
			const bytes = await res.arrayBuffer();
			if (bytes.byteLength > MAX_PDF_BYTES) throw new AppError('too_large', 'PDF가 50MB를 넘습니다.');
			if (!looksLikePdf(bytes)) throw new AppError('not_pdf', '링크의 파일이 PDF가 아닙니다.');
			const pageCount = await pdfPageCount(bytes);
			if (pageCount === null) throw new AppError('broken_pdf', 'PDF를 열 수 없습니다.');
			const sha256 = await sha256Hex(bytes);
			const filename = decodeURIComponent(new URL(res.url || url).pathname.split('/').pop() || 'price.pdf');
			await putPdf(bucket, sha256, bytes, { filename, origin: 'url', sourceUrl: url });
			return {
				sha256,
				filename,
				pageCount,
				sizeBytes: bytes.byteLength,
				etag: res.headers.get('etag') ?? '',
				lastModified: res.headers.get('last-modified') ?? '',
			};
		});

		const sourceId = sourceIdFromSha(saved.sha256);
		const added = await step.do('record', () =>
			repo.addPdfSourceIfNew({
				sourceId,
				origin: 'url',
				sourceUrl: url,
				filename: saved.filename,
				pdfKey: keys.pdf(saved.sha256),
				sha256: saved.sha256,
				sizeBytes: saved.sizeBytes,
				pageCount: saved.pageCount,
				etag: saved.etag,
				lastModified: saved.lastModified,
				kind: 'unknown',
			}),
		);
		return {
			output: {
				sourceId,
				filename: saved.filename,
				sizeBytes: saved.sizeBytes,
				alreadyKnown: !added,
				nextStep: next('prepare_source', { sourceId, ...(data.conversationId ? { conversationId: data.conversationId } : {}) }),
			},
		};
	},
});
