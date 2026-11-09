// Minimal in-memory stand-in for an R2Bucket — enough for put/get/head/delete with
// the conditional writes the app relies on. Keeps unit tests free of Cloudflare calls.

interface Stored {
	bytes: Uint8Array;
	etag: string;
	customMetadata: Record<string, string>;
	contentType?: string;
	uploaded: Date;
}

let counter = 0;

const toBytes = async (value: unknown): Promise<Uint8Array> => {
	if (typeof value === 'string') return new TextEncoder().encode(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	if (value === null || value === undefined) return new Uint8Array();
	throw new Error('fake R2: unsupported value type');
};

type OnlyIf = Headers | { etagMatches?: string; etagDoesNotMatch?: string } | undefined;

function preconditionOk(onlyIf: OnlyIf, existing: Stored | undefined): boolean {
	if (!onlyIf) return true;
	if (onlyIf instanceof Headers) {
		const noneMatch = onlyIf.get('If-None-Match');
		if (noneMatch === '*') return existing === undefined;
		const match = onlyIf.get('If-Match');
		if (match) return existing?.etag === match;
		return true;
	}
	if (onlyIf.etagMatches !== undefined) return existing?.etag === onlyIf.etagMatches;
	if (onlyIf.etagDoesNotMatch !== undefined) return existing?.etag !== onlyIf.etagDoesNotMatch;
	return true;
}

export class FakeR2 {
	readonly objects = new Map<string, Stored>();

	async put(key: string, value: unknown, options: { onlyIf?: OnlyIf; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } = {}) {
		const existing = this.objects.get(key);
		if (!preconditionOk(options.onlyIf, existing)) return null;
		const stored: Stored = {
			bytes: await toBytes(value),
			etag: `etag-${++counter}`,
			customMetadata: options.customMetadata ?? {},
			contentType: options.httpMetadata?.contentType,
			uploaded: new Date(),
		};
		this.objects.set(key, stored);
		return this.meta(key, stored);
	}

	async head(key: string) {
		const s = this.objects.get(key);
		return s ? this.meta(key, s) : null;
	}

	async get(key: string) {
		const s = this.objects.get(key);
		if (!s) return null;
		const bytes = s.bytes;
		return {
			...this.meta(key, s),
			body: new Response(bytes).body,
			arrayBuffer: async () => bytes.slice().buffer,
			text: async () => new TextDecoder().decode(bytes),
			json: async () => JSON.parse(new TextDecoder().decode(bytes)),
		};
	}

	async delete(key: string | string[]) {
		for (const k of Array.isArray(key) ? key : [key]) this.objects.delete(k);
	}

	private meta(key: string, s: Stored) {
		return {
			key,
			etag: s.etag,
			httpEtag: `"${s.etag}"`,
			size: s.bytes.byteLength,
			uploaded: s.uploaded,
			customMetadata: s.customMetadata,
			httpMetadata: { contentType: s.contentType },
		};
	}
}

/** Typed as the real binding for code under test. */
export const asBucket = (fake: FakeR2) => fake as unknown as R2Bucket;
