// Service-account OAuth for Google APIs using Web Crypto (no Node-only googleapis package).
// https://developers.google.com/identity/protocols/oauth2/service-account

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface ServiceAccount {
	email: string;
	/** PEM PKCS#8. Accepts literal `\n` escapes as pasted from the JSON key file. */
	privateKey: string;
}

const base64url = (bytes: Uint8Array): string => {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const base64urlJson = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

export function normalizePem(pem: string): string {
	return pem.trim().replace(/^"|"$/g, '').replaceAll('\\n', '\n');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const body = normalizePem(pem)
		.replace('-----BEGIN PRIVATE KEY-----', '')
		.replace('-----END PRIVATE KEY-----', '')
		.replace(/\s+/g, '');
	const der = Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0));
	return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** Signed JWT assertion for the token endpoint. Exported for tests. */
export async function createAssertion(sa: ServiceAccount, scope: string, nowSeconds: number): Promise<string> {
	const header = base64urlJson({ alg: 'RS256', typ: 'JWT' });
	const claims = base64urlJson({ iss: sa.email, scope, aud: TOKEN_URL, iat: nowSeconds, exp: nowSeconds + 3600 });
	const signingInput = `${header}.${claims}`;
	const key = await importPrivateKey(sa.privateKey);
	const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
	return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}

// Token cache: not request state — a credential with its own expiry, shared safely within an isolate.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(
	sa: ServiceAccount,
	scope = SHEETS_SCOPE,
	fetcher: typeof fetch = (input, init) => fetch(input, init),
	now: () => number = Date.now,
): Promise<string> {
	const cacheKey = `${sa.email}|${scope}`;
	const cached = tokenCache.get(cacheKey);
	if (cached && cached.expiresAt - 60_000 > now()) return cached.token;

	const assertion = await createAssertion(sa, scope, Math.floor(now() / 1000));
	const res = await fetcher(TOKEN_URL, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
	});
	if (!res.ok) {
		throw new Error(`Google token request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
	}
	const data = (await res.json()) as { access_token: string; expires_in: number };
	tokenCache.set(cacheKey, { token: data.access_token, expiresAt: now() + data.expires_in * 1000 });
	return data.access_token;
}

export function clearTokenCache(): void {
	tokenCache.clear();
}
