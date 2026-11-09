// Shared plumbing for Flue tools: bindings, repo, job-state updates, next-step hints.
import type { JobState } from '@shared/types';
import { getRepo, isSheetsConfigured } from '../sheets/index.ts';
import { getEnv } from '../shared/env.ts';
import { AppError } from '../shared/errors.ts';
import { readState, writeState } from '../store/r2.ts';

export function deps() {
	const env = getEnv();
	return {
		env,
		bucket: env.FILES,
		repo: getRepo(env),
		sheetsConfigured: isSheetsConfigured(env),
		openaiAvailable: Boolean(env.OPENAI_API_KEY),
	};
}

export type NextStep = { tool: string; args: Record<string, string | boolean> } | null;

export const next = (tool: string, args: Record<string, string | boolean>): NextStep => ({ tool, args });

export async function loadState(bucket: R2Bucket, jobId: string): Promise<JobState> {
	const st = await readState(bucket, jobId);
	if (!st) throw new AppError('not_found', `작업 ${jobId}을(를) 찾을 수 없습니다.`, 404);
	return st.value;
}

/** Read-modify-write of job state with optimistic concurrency (a few retries). */
export async function updateState(bucket: R2Bucket, jobId: string, mutate: (s: JobState) => JobState): Promise<JobState> {
	for (let attempt = 0; attempt < 4; attempt++) {
		const cur = await readState(bucket, jobId);
		if (!cur) throw new AppError('not_found', `작업 ${jobId}을(를) 찾을 수 없습니다.`, 404);
		const nextState = mutate(structuredClone(cur.value));
		if (await writeState(bucket, nextState, cur.etag)) return nextState;
	}
	throw new AppError('state_conflict', '작업 상태를 저장하지 못했습니다(동시 수정). 다시 시도하세요.', 409);
}

export function requireStage(state: JobState, allowed: JobState['stage'][], tool: string): void {
	if (!allowed.includes(state.stage)) {
		throw new AppError(
			'wrong_stage',
			`${tool}은(는) 작업 단계가 ${allowed.join('/')}일 때만 실행할 수 있습니다(현재: ${state.stage}). get_job으로 상태를 확인하고 nextStep을 따르세요.`,
		);
	}
}

export const jobUrl = (jobId: string) => `/jobs/${jobId}`;
