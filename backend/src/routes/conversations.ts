import { Hono } from 'hono';
import * as v from 'valibot';
import { getRepo } from '../sheets/index.ts';
import { parseJson } from './validate.ts';

const Title = v.pipe(v.string(), v.trim(), v.minLength(1, '제목이 비어 있습니다.'), v.maxLength(100, '제목은 100자 이내로 입력하세요.'));

export const conversations = new Hono<{ Bindings: Env }>();

conversations.get('/', async (c) => c.json(await getRepo(c.env).listConversations()));

conversations.post('/', async (c) => {
	const { title } = await parseJson(c, v.object({ title: v.optional(Title) }));
	return c.json(await getRepo(c.env).createConversation(title ?? '새 작업'), 201);
});

conversations.patch('/:id', async (c) => {
	const { title } = await parseJson(c, v.object({ title: Title }));
	return c.json(await getRepo(c.env).updateConversation(c.req.param('id'), { title }));
});

conversations.delete('/:id', async (c) => {
	await getRepo(c.env).updateConversation(c.req.param('id'), { deleted: true });
	return c.body(null, 204);
});
