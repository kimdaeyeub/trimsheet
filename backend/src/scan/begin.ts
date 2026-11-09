import { getRepo } from '../sheets/index.ts';
import { SCAN_POLICY } from '../shared/config.ts';
import { startWatcherScan } from '../shared/dispatch.ts';
import { newId } from '../shared/ids.ts';
import type { ScanMode } from './scan.ts';

/** First scan registers a baseline only (PLAN.md §7.11 (4)); later scans process new items. */
export async function scanModeFor(env: Env): Promise<ScanMode> {
	if (SCAN_POLICY.initialScanMode !== 'baseline_only') return 'normal';
	return (await getRepo(env).getSetting('baseline_done')) === 'TRUE' ? 'normal' : 'baseline';
}

export async function beginScan(env: Env, trigger: 'cron' | 'manual'): Promise<{ scanRunId: string; mode: ScanMode }> {
	const scanRunId = newId('scan');
	const mode = await scanModeFor(env);
	await getRepo(env).startScanRun(scanRunId, trigger, mode);
	await startWatcherScan({ scanRunId, mode, trigger });
	return { scanRunId, mode };
}
