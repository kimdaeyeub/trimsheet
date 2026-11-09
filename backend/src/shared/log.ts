type Level = 'debug' | 'info' | 'warn' | 'error';

/** Structured JSON log line — Workers Logs indexes the fields. */
export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
	const line = JSON.stringify({ level, event, ...fields });
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);
}
