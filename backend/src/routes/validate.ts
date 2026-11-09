import type { Context } from 'hono';
import * as v from 'valibot';
import { AppError } from '../shared/errors.ts';

export async function parseJson<S extends v.GenericSchema>(c: Context, schema: S): Promise<v.InferOutput<S>> {
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw new AppError('invalid_json', '요청 본문이 올바른 JSON이 아닙니다.');
	}
	const result = v.safeParse(schema, body);
	if (!result.success) {
		throw new AppError('invalid_input', result.issues.map((i) => i.message).join('; '));
	}
	return result.output;
}
