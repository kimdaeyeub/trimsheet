// Starting agent conversations from routes and tools. Imported lazily so plain Node unit tests
// (which never call these) do not load the agent modules and their Workers-only dependencies.
export interface StartJobInput {
	conversationId: string;
	sourceId: string;
	filename?: string;
	note: string;
}

/** Ask the TrimSheet agent to process an already-registered PDF in a new conversation. */
export async function startTrimSheetJob(input: StartJobInput): Promise<void> {
	const [{ dispatch }, { TrimSheet }] = await Promise.all([import('@flue/runtime'), import('../agents/trimsheet.ts')]);
	const tokens = [`[source:${input.sourceId}]`, input.filename ? `[file:${encodeURIComponent(input.filename)}]` : '', `[conversation:${input.conversationId}]`]
		.filter(Boolean)
		.join(' ');
	await dispatch(TrimSheet, { id: input.conversationId, message: { kind: 'user', body: `${input.note} ${tokens}` } });
}

/** Kick off a scan of all three brands through the Watcher agent. */
export async function startWatcherScan(input: { scanRunId: string; mode: 'baseline' | 'normal'; trigger: 'cron' | 'manual' }): Promise<void> {
	const [{ dispatch }, { Watcher }] = await Promise.all([import('@flue/runtime'), import('../agents/watcher.ts')]);
	await dispatch(Watcher, {
		id: input.scanRunId,
		message: {
			kind: 'signal',
			type: 'weekly_scan',
			body: '현대·기아·제네시스 홈페이지에서 새 가격표를 확인하세요.',
			attributes: { scanRunId: input.scanRunId, mode: input.mode, trigger: input.trigger },
		},
	});
}
