// Picks the real Google Sheets backend when configured, otherwise an in-memory placeholder.
import { getAccessToken } from './auth.ts';
import { GoogleSheetsPort } from './google.ts';
import { MemorySheetsPort } from './memory.ts';
import { SheetsRepo } from './repo.ts';

export interface SheetsEnv {
	GOOGLE_SPREADSHEET_ID?: string;
	GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
	GOOGLE_PRIVATE_KEY?: string;
}

export function isSheetsConfigured(env: SheetsEnv): boolean {
	return Boolean(env.GOOGLE_SPREADSHEET_ID && env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_PRIVATE_KEY);
}

// Local-dev placeholder until Google Sheets is set up. Lives for the isolate's lifetime only;
// /api/health reports `not_configured` so this is never mistaken for real storage.
let memoryPort: MemorySheetsPort | null = null;

export function getRepo(env: SheetsEnv): SheetsRepo {
	if (isSheetsConfigured(env)) {
		const sa = { email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL!, privateKey: env.GOOGLE_PRIVATE_KEY! };
		const port = new GoogleSheetsPort({ spreadsheetId: env.GOOGLE_SPREADSHEET_ID!, getToken: () => getAccessToken(sa) });
		return new SheetsRepo(port, `google:${env.GOOGLE_SPREADSHEET_ID}`);
	}
	memoryPort ??= new MemorySheetsPort();
	return new SheetsRepo(memoryPort, 'memory');
}

/** Test hook. */
export function resetMemorySheets(): void {
	memoryPort = null;
}
