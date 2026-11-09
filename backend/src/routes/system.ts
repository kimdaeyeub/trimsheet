import { Hono } from 'hono';
import type { HealthResponse, SettingsResponse } from '@shared/types';
import { getRepo, isSheetsConfigured } from '../sheets/index.ts';
import { SCAN_POLICY } from '../shared/config.ts';
import { log } from '../shared/log.ts';

export const system = new Hono<{ Bindings: Env }>();

system.get('/health', async (c) => {
	let sheets: HealthResponse['sheets'] = 'not_configured';
	if (isSheetsConfigured(c.env)) {
		try {
			await getRepo(c.env).ensureLayout();
			sheets = 'ok';
		} catch (err) {
			log('error', 'sheets_health_failed', { message: err instanceof Error ? err.message : String(err) });
			sheets = 'error';
		}
	}
	return c.json<HealthResponse>({ ok: true, sheets, openai: Boolean(c.env.OPENAI_API_KEY) });
});

system.get('/settings', async (c) => {
	const configured = isSheetsConfigured(c.env);
	const repo = getRepo(c.env);
	return c.json<SettingsResponse>({
		spreadsheetUrl: configured ? repo.port.spreadsheetUrl() : null,
		tabs: configured ? await repo.tabGids() : {},
		scanPolicy: { ...SCAN_POLICY },
	});
});
