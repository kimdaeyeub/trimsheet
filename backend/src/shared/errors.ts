import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ApiError } from '@shared/types';
import { log } from './log.ts';

export class AppError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: ContentfulStatusCode = 400,
	) {
		super(message);
		this.name = 'AppError';
	}
}

export const notFound = (what: string) => new AppError('not_found', `${what}을(를) 찾을 수 없습니다.`, 404);

/** Hono `onError`: structured JSON errors, never a stack trace to the client. */
export function handleError(err: Error, c: Context): Response {
	if (err instanceof AppError) {
		return c.json<ApiError>({ error: { code: err.code, message: err.message } }, err.status);
	}
	log('error', 'unhandled_error', { path: c.req.path, message: err.message, stack: err.stack });
	return c.json<ApiError>({ error: { code: 'internal', message: '서버 오류가 발생했습니다.' } }, 500);
}
