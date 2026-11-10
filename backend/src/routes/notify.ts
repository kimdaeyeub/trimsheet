// New-data email settings for the frontend's email modal.
import { Hono } from 'hono';
import * as v from 'valibot';
import type { NotifyStatus, NotifyTestResult } from '@shared/types';
import { MAX_SUBSCRIBERS, addSubscriber, listSubscribers, removeSubscriber, sendToSubscribers, sendingStatus, testMail } from '../notify/email.ts';
import { getRepo } from '../sheets/index.ts';
import { AppError } from '../shared/errors.ts';

export const notify = new Hono<{ Bindings: Env }>();

const status = async (env: Env): Promise<NotifyStatus> => ({
	subscribers: await listSubscribers(getRepo(env)),
	sending: sendingStatus(env),
	max: MAX_SUBSCRIBERS,
});

notify.get('/', async (c) => c.json<NotifyStatus>(await status(c.env)));

const AddBody = v.object({ email: v.pipe(v.string(), v.maxLength(254)) });

notify.post('/', async (c) => {
	const parsed = v.safeParse(AddBody, await c.req.json().catch(() => null));
	if (!parsed.success) throw new AppError('invalid_body', '이메일 주소를 입력하세요.');
	const { added } = await addSubscriber(getRepo(c.env), parsed.output.email);
	return c.json<NotifyStatus & { added: boolean }>({ ...(await status(c.env)), added }, added ? 201 : 200);
});

notify.delete('/:id', async (c) => {
	if (!(await removeSubscriber(getRepo(c.env), c.req.param('id')))) throw new AppError('not_found', '등록된 주소가 아닙니다.', 404);
	return c.json<NotifyStatus>(await status(c.env));
});

notify.post('/test', async (c) => {
	const r = await sendToSubscribers(c.env, getRepo(c.env), testMail(c.env.APP_URL));
	return c.json<NotifyTestResult>({ sending: r.status, sent: r.sent, failed: r.failed });
});
