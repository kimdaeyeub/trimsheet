import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { downloadPdf, probe, unchanged } from '../crawl/fetch-pdf.ts';
import { pdfPageCount } from '../pipeline/pdf-info.ts';
import { AppError } from '../shared/errors.ts';
import { sha256Hex, sourceIdFromSha } from '../shared/ids.ts';
import { keys, putPdf } from '../store/r2.ts';
import { deps, next } from './common.ts';
import { durable } from '../shared/durable.ts';

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
		'가격표 PDF 링크(https, hyundai.com/kia.com/genesis.com — find_pdfs_on_page가 준 URL 포함)를 내려받아 등록합니다. 이미 받은 파일이면 다시 받지 않습니다. 결과의 nextStep을 이어서 호출하세요.',
	input: v.object({ url: v.pipe(v.string(), v.url()), conversationId: v.optional(v.string()) }),
	durable: true,
	timeoutMs: 60_000,
	async run({ data, step, log, signal }) {
		const url = checkUrl(data.url).toString();
		const { bucket, repo } = deps();

		// L1: same URL with unchanged ETag/Last-Modified → no download.
		const known = await repo.findPdfSourceByUrl(url);
		if (known) {
			const probed = await durable(step)('head', () => probe(url, signal));
			if (unchanged(known, probed)) {
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

		const saved = await durable(step)('download', async () => {
			const dl = await downloadPdf({ url }, signal);
			const pageCount = await pdfPageCount(dl.bytes);
			if (pageCount === null) throw new AppError('broken_pdf', 'PDF를 열 수 없습니다.');
			const sha256 = await sha256Hex(dl.bytes);
			await putPdf(bucket, sha256, dl.bytes, { filename: dl.filename, origin: 'url', sourceUrl: url });
			return { sha256, filename: dl.filename, pageCount, sizeBytes: dl.bytes.byteLength, etag: dl.etag, lastModified: dl.lastModified };
		});

		const sourceId = sourceIdFromSha(saved.sha256);
		const added = await durable(step)('record', () =>
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
