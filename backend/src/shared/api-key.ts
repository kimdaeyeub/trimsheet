// The backend has a public workers.dev URL once the frontend lives on Vercel. Every /api request
// must then carry the shared key (added by the Vercel proxy function, never sent to the browser).
// Without API_KEY set (local dev behind the service binding), nothing is checked.
import type { MiddlewareHandler } from 'hono';

export const API_KEY_HEADER = 'x-trimsheet-key';

/** Constant-time string comparison (both sides hashed so lengths do not leak either). */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const enc = new TextEncoder();
	const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
	const x = new Uint8Array(ha);
	const y = new Uint8Array(hb);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

export const requireApiKey: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
	const expected = c.env.API_KEY;
	if (!expected) return next();
	const given = c.req.header(API_KEY_HEADER) ?? '';
	if (!given || !(await safeEqual(given, expected))) {
		return c.json({ error: { code: 'unauthorized', message: '인증되지 않은 요청입니다.' } }, 401);
	}
	return next();
};
