const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** `YYYY-MM-DD HH:mm:ss` in Korea Standard Time — the format used in every sheet cell. */
export function kstNow(now: Date = new Date()): string {
	return new Date(now.getTime() + KST_OFFSET_MS).toISOString().replace('T', ' ').slice(0, 19);
}

/** ISO timestamp (UTC) for machine state such as R2 JobState. */
export function isoNow(now: Date = new Date()): string {
	return now.toISOString();
}
