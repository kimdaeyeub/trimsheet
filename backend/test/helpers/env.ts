import { FakeR2, asBucket } from './fake-r2.ts';

/** Env for route tests: fake R2, Google Sheets not configured (memory placeholder). */
export function makeEnv(overrides: Partial<Env> = {}) {
	const r2 = new FakeR2();
	const env = {
		FILES: asBucket(r2),
		GOOGLE_SPREADSHEET_ID: '',
		GOOGLE_SERVICE_ACCOUNT_EMAIL: '',
		GOOGLE_PRIVATE_KEY: '',
		OPENAI_API_KEY: '',
		...overrides,
	} as Env;
	return { env, r2 };
}
