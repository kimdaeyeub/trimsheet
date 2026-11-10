import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPdf, genesisPdfUrl } from '../src/crawl/fetch-pdf.ts';
import { makePdf } from './helpers/pdf.ts';

afterEach(() => vi.unstubAllGlobals());

describe('downloadPdf', () => {
	it('sends a User-Agent and the Genesis form (an empty UA gets an empty body from Genesis)', async () => {
		const pdf = await makePdf(1);
		const calls: { url: string; init: RequestInit }[] = [];
		vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
			calls.push({ url, init });
			return new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf' } });
		});
		const dl = await downloadPdf({ url: genesisPdfUrl('KEY1'), filename: 'genesis-gv70-pricelist-kor-202611.pdf' });
		expect(dl.bytes.byteLength).toBe(pdf.byteLength);
		const { init } = calls[0];
		expect(init.method).toBe('POST');
		const headers = new Headers(init.headers);
		expect(headers.get('user-agent')).toMatch(/TrimSheet/);
		expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');
		expect(String(init.body)).toBe('file_key=KEY1');
	});

	it('says what came back when the response is not a PDF', async () => {
		vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }));
		await expect(downloadPdf({ url: 'https://example.com/a.pdf' })).rejects.toThrow(/PDF가 아닙니다 \(받은 형식: 알 수 없음, 0바이트\)/);
		vi.stubGlobal('fetch', async () => new Response('<html><body>Access denied</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
		await expect(downloadPdf({ url: 'https://example.com/a.pdf' })).rejects.toThrow(/text\/html.*Access denied/);
	});
});
