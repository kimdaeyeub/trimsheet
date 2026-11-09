export type IdPrefix = 'job' | 'itm' | 'scan' | 'ntf';

export function newId(prefix: IdPrefix): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

/** Same PDF bytes → same source id, so no separate index is needed. */
export function sourceIdFromSha(sha256: string): string {
	return `src_${sha256.slice(0, 16)}`;
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
