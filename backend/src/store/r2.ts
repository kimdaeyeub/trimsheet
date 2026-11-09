// R2 is file storage, not a database (PLAN.md §0.5, §4.2):
// original PDFs, per-job state, vehicle locks and intermediate extraction results.
import type { JobState } from '@shared/types';
import { isoNow } from '../shared/time.ts';

export const keys = {
	pdf: (sha256: string) => `pdf/${sha256}.pdf`,
	jobState: (jobId: string) => `jobs/${jobId}/state.json`,
	jobFile: (jobId: string, name: string) => `jobs/${jobId}/${name}`,
	vehicleLock: (vehicleKey: string) => `locks/vehicle/${encodeURIComponent(vehicleKey)}.json`,
};

export interface PdfMeta {
	filename: string;
	origin: 'upload' | 'url' | 'crawl';
	sourceUrl?: string;
}

/** Stores a PDF under its content hash. Returns false when the same bytes were already stored. */
export async function putPdf(bucket: R2Bucket, sha256: string, bytes: ArrayBuffer, meta: PdfMeta): Promise<boolean> {
	const stored = await bucket.put(keys.pdf(sha256), bytes, {
		onlyIf: new Headers({ 'If-None-Match': '*' }),
		httpMetadata: { contentType: 'application/pdf' },
		customMetadata: {
			filename: encodeURIComponent(meta.filename),
			origin: meta.origin,
			...(meta.sourceUrl ? { sourceUrl: meta.sourceUrl } : {}),
		},
	});
	return stored !== null;
}

export async function getPdfBytes(bucket: R2Bucket, sha256: string): Promise<ArrayBuffer | null> {
	const obj = await bucket.get(keys.pdf(sha256));
	return obj ? obj.arrayBuffer() : null;
}

export async function putJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
	await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } });
}

export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
	const obj = await bucket.get(key);
	return obj ? ((await obj.json()) as T) : null;
}

export interface Versioned<T> {
	value: T;
	etag: string;
}

export async function readState(bucket: R2Bucket, jobId: string): Promise<Versioned<JobState> | null> {
	const obj = await bucket.get(keys.jobState(jobId));
	if (!obj) return null;
	return { value: (await obj.json()) as JobState, etag: obj.etag };
}

/**
 * Optimistic write of job state.
 * - `expectedEtag` undefined → create only (fails if the job already exists)
 * - `expectedEtag` string → overwrite only if nobody else wrote in between
 * Returns the new etag, or null when the precondition failed.
 */
export async function writeState(bucket: R2Bucket, state: JobState, expectedEtag?: string): Promise<string | null> {
	const next: JobState = { ...state, updatedAt: isoNow() };
	const stored = await bucket.put(keys.jobState(state.jobId), JSON.stringify(next), {
		onlyIf: expectedEtag === undefined ? new Headers({ 'If-None-Match': '*' }) : { etagMatches: expectedEtag },
		httpMetadata: { contentType: 'application/json' },
	});
	return stored ? stored.etag : null;
}

interface LockBody {
	jobId: string;
	createdAt: string;
}

/** Per-vehicle lock so the same car is never processed twice at once (PLAN.md §7.11). */
export async function acquireVehicleLock(
	bucket: R2Bucket,
	vehicleKey: string,
	jobId: string,
	ttlMinutes: number,
	now: Date = new Date(),
): Promise<{ acquired: true } | { acquired: false; heldBy: string }> {
	const key = keys.vehicleLock(vehicleKey);
	const body: LockBody = { jobId, createdAt: now.toISOString() };
	const created = await bucket.put(key, JSON.stringify(body), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
	if (created) return { acquired: true };

	const existing = await bucket.get(key);
	if (!existing) {
		// Released between our put and get — try once more.
		const retry = await bucket.put(key, JSON.stringify(body), { onlyIf: new Headers({ 'If-None-Match': '*' }) });
		return retry ? { acquired: true } : { acquired: false, heldBy: 'unknown' };
	}
	const held = (await existing.json()) as LockBody;
	const expired = now.getTime() - new Date(held.createdAt).getTime() > ttlMinutes * 60_000;
	if (!expired) return { acquired: false, heldBy: held.jobId };

	// Take over an expired lock only if it is still the one we just read.
	const taken = await bucket.put(key, JSON.stringify(body), { onlyIf: { etagMatches: existing.etag } });
	return taken ? { acquired: true } : { acquired: false, heldBy: 'unknown' };
}

export async function releaseVehicleLock(bucket: R2Bucket, vehicleKey: string, jobId: string): Promise<void> {
	const key = keys.vehicleLock(vehicleKey);
	const existing = await bucket.get(key);
	if (!existing) return;
	const held = (await existing.json()) as LockBody;
	if (held.jobId === jobId) await bucket.delete(key);
}
