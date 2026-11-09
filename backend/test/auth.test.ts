import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearTokenCache, createAssertion, getAccessToken, normalizePem } from '../src/sheets/auth.ts';

async function makeServiceAccount() {
	const pair = (await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	)) as CryptoKeyPair;
	const pkcs8 = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
	const b64 = btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, '$1\n');
	// As pasted into .env: one line with literal \n escapes, wrapped in quotes.
	const privateKey = JSON.stringify(`-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`);
	return { sa: { email: 'writer@test.iam.gserviceaccount.com', privateKey }, publicKey: pair.publicKey };
}

const decode = (part: string) => JSON.parse(atob(part.replaceAll('-', '+').replaceAll('_', '/')));

afterEach(() => clearTokenCache());

describe('service account auth', () => {
	it('normalizes pasted PEM keys', () => {
		expect(normalizePem('"a\\nb"')).toBe('a\nb');
	});

	it('creates a verifiable RS256 assertion with the expected claims', async () => {
		const { sa, publicKey } = await makeServiceAccount();
		const jwt = await createAssertion(sa, 'scope-x', 1_000);
		const [h, p, s] = jwt.split('.');
		expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
		expect(decode(p)).toEqual({ iss: sa.email, scope: 'scope-x', aud: 'https://oauth2.googleapis.com/token', iat: 1_000, exp: 4_600 });
		const sig = Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (ch) => ch.charCodeAt(0));
		const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
		expect(ok).toBe(true);
	});

	it('exchanges the assertion for a token and caches it until near expiry', async () => {
		const { sa } = await makeServiceAccount();
		const fetcher = vi.fn(async () => Response.json({ access_token: 'tok', expires_in: 3600 }));
		let now = 0;
		const get = () => getAccessToken(sa, 'scope', fetcher as unknown as typeof fetch, () => now);
		expect(await get()).toBe('tok');
		now = 3_000_000; // 50 minutes later — still cached
		await get();
		expect(fetcher).toHaveBeenCalledTimes(1);
		now = 3_560_000; // within 60 s of expiry — refresh
		await get();
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('surfaces token endpoint errors', async () => {
		const { sa } = await makeServiceAccount();
		const fetcher = async () => new Response('{"error":"invalid_grant"}', { status: 400 });
		await expect(getAccessToken(sa, 'scope', fetcher as unknown as typeof fetch)).rejects.toThrow(/invalid_grant/);
	});
});
