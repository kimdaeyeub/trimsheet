import { beforeEach, describe, expect, it } from 'vitest';
import type { NotifyStatus, NotifyTestResult } from '@shared/types';
import { maskEmail, newDataMail, sendToSubscribers, sendingStatus } from '../src/notify/email.ts';
import { api } from '../src/routes/index.ts';
import { getRepo, resetMemorySheets } from '../src/sheets/index.ts';
import { resetLayoutMemo } from '../src/sheets/repo.ts';
import { makeEnv } from './helpers/env.ts';

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

function fakeMailer(failFor: string[] = []) {
	const sent: { to: string; subject: string; from: unknown }[] = [];
	const EMAIL = {
		async send(m: { to: string; subject: string; from: unknown }) {
			if (failFor.includes(m.to)) throw new Error('destination address not verified');
			sent.push({ to: m.to, subject: m.subject, from: m.from });
			return { messageId: `m${sent.length}` };
		},
	} as unknown as SendEmail;
	return { EMAIL, sent };
}

beforeEach(() => {
	resetMemorySheets();
	resetLayoutMemo();
});

describe('email helpers', () => {
	it('masks addresses', () => {
		expect(maskEmail('jane.doe@example.com')).toBe('ja******@example.com');
		expect(maskEmail('a@b.co')).toBe('a*@b.co');
	});

	it('reports why sending is off', () => {
		expect(sendingStatus({ NOTIFY_FROM: '', APP_URL: '' })).toBe('no_binding');
		expect(sendingStatus({ NOTIFY_FROM: '', APP_URL: '', EMAIL: fakeMailer().EMAIL })).toBe('no_sender');
		expect(sendingStatus({ NOTIFY_FROM: 'bot@example.com', APP_URL: '', EMAIL: fakeMailer().EMAIL })).toBe('ready');
	});

	it('builds a new-data message with an escaped title and a link', () => {
		const m = newDataMail(
			{ vehicleName: '쏘렌토 <X>', modelYear: '2026', brand: '기아', counts: { trims: 10, colors: 8, options: 18, rules: 7, review: 2 }, jobId: 'job_1', replaced: false },
			'https://app.example.com/',
		);
		expect(m.subject).toBe('[TrimSheet] 기아 쏘렌토 <X> 2026년 가격 정보가 추가되었습니다');
		expect(m.html).toContain('쏘렌토 &lt;X&gt;');
		expect(m.text).toContain('https://app.example.com/?v=job_1');
		expect(m.text).toContain('확인이 필요한 항목이 2개');
	});
});

describe('/api/notify', () => {
	it('adds, lists (masked), de-duplicates, rejects bad input and removes', async () => {
		const { env } = makeEnv();
		const add = (email: string) => api.request('http://t/notify', json('POST', { email }), env);

		const r1 = await add('  Me@Example.com ');
		expect(r1.status).toBe(201);
		const s1 = (await r1.json()) as NotifyStatus & { added: boolean };
		expect(s1.subscribers.map((s) => s.masked)).toEqual(['me@example.com'.replace(/^(me)/, 'm*')]);
		expect(s1.sending).toBe('no_binding');
		expect(JSON.stringify(s1)).not.toContain('me@example.com');

		expect((await add('me@example.com')).status).toBe(200); // already there
		expect((await add('not-an-email')).status).toBe(400);

		const id = s1.subscribers[0].id;
		const del = (await (await api.request(`http://t/notify/${id}`, { method: 'DELETE' }, env)).json()) as NotifyStatus;
		expect(del.subscribers).toEqual([]);
		expect((await api.request(`http://t/notify/${id}`, { method: 'DELETE' }, env)).status).toBe(404);
	});

	it('sends a test mail to each subscriber and counts failures without throwing', async () => {
		const mailer = fakeMailer(['bad@example.com']);
		const { env } = makeEnv({ EMAIL: mailer.EMAIL, NOTIFY_FROM: 'bot@example.com' } as Partial<Env>);
		for (const e of ['a@example.com', 'bad@example.com', 'b@example.com']) await api.request('http://t/notify', json('POST', { email: e }), env);
		const r = (await (await api.request('http://t/notify/test', json('POST'), env)).json()) as NotifyTestResult;
		expect(r).toEqual({ sending: 'ready', sent: 2, failed: 1 });
		expect(mailer.sent.map((m) => m.to)).toEqual(['a@example.com', 'b@example.com']);
		expect(mailer.sent[0].from).toEqual({ email: 'bot@example.com', name: 'TrimSheet' });
	});

	it('sends nothing when not configured', async () => {
		const { env } = makeEnv();
		await getRepo(env).setSetting('notify.emails', JSON.stringify([{ email: 'a@example.com', addedAt: '' }]));
		expect(await sendToSubscribers(env, getRepo(env), { subject: 's', text: 't', html: 'h' })).toEqual({ status: 'no_binding', sent: 0, failed: 0 });
	});
});
