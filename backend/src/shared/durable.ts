// Flue records every durable step's return value as JSON and rejects `undefined`, at the top level
// or nested ("value must not contain undefined values"). Many steps here just write something and
// return nothing, so every step goes through `durable(step)` instead of `step.do` directly.
// Found 2026-11-10: prepare_source failed at "job-row" and extract_pass at "save-pass:A".

export interface StepLike {
	do<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
}

/** JSON-safe copy: `undefined` → `null`, undefined object fields dropped. */
export function storable<T>(value: T): T {
	return value === undefined ? (null as T) : (JSON.parse(JSON.stringify(value)) as T);
}

/** `step.do` that always records a storable value. */
export function durable(step: StepLike) {
	return <T>(name: string, fn: () => T | Promise<T>): Promise<T> => step.do(name, async () => storable(await fn()));
}
