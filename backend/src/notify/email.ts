// New-data email: subscriber list in the hidden _설정 tab (no DB), sending through the
// Cloudflare Email Service binding. Sending is best-effort and never fails the job that triggered it.
import type { NotifySubscriber, NotifyStatus } from '@shared/types';
import type { SheetsRepo } from '../sheets/repo.ts';
import { AppError } from '../shared/errors.ts';
import { log } from '../shared/log.ts';
import { kstNow } from '../shared/time.ts';

export const SETTING_KEY = 'notify.emails';
export const MAX_SUBSCRIBERS = 20;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

interface Stored {
	email: string;
	addedAt: string;
}

export const normalizeEmail = (s: string) => s.trim().toLowerCase();
export const isValidEmail = (s: string) => s.length <= 254 && EMAIL_RE.test(s);

/** "jane.doe@example.com" → "ja******@example.com" — the list is shown on a page without login. */
export function maskEmail(email: string): string {
	const [local, domain] = email.split('@');
	const keep = local.length <= 2 ? 1 : 2;
	return `${local.slice(0, keep)}${'*'.repeat(Math.max(1, local.length - keep))}@${domain}`;
}

/** Stable id used to remove an address without sending it back to the browser. */
export async function subscriberId(email: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
	return [...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function load(repo: SheetsRepo): Promise<Stored[]> {
	const raw = await repo.getSetting(SETTING_KEY);
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? parsed.filter((x): x is Stored => typeof x?.email === 'string') : [];
	} catch {
		return [];
	}
}

const save = (repo: SheetsRepo, list: Stored[]) => repo.setSetting(SETTING_KEY, JSON.stringify(list));

export async function listSubscribers(repo: SheetsRepo): Promise<NotifySubscriber[]> {
	return Promise.all((await load(repo)).map(async (s) => ({ id: await subscriberId(s.email), masked: maskEmail(s.email), addedAt: s.addedAt })));
}

export async function addSubscriber(repo: SheetsRepo, input: string): Promise<{ added: boolean; subscriber: NotifySubscriber }> {
	const email = normalizeEmail(input);
	if (!isValidEmail(email)) throw new AppError('invalid_email', '이메일 주소 형식이 올바르지 않습니다.');
	const list = await load(repo);
	const existing = list.find((s) => s.email === email);
	if (!existing && list.length >= MAX_SUBSCRIBERS) throw new AppError('too_many', `알림 받을 주소는 ${MAX_SUBSCRIBERS}개까지 등록할 수 있습니다.`);
	const entry = existing ?? { email, addedAt: kstNow() };
	if (!existing) await save(repo, [...list, entry]);
	return { added: !existing, subscriber: { id: await subscriberId(email), masked: maskEmail(email), addedAt: entry.addedAt } };
}

export async function removeSubscriber(repo: SheetsRepo, id: string): Promise<boolean> {
	const list = await load(repo);
	const keep: Stored[] = [];
	for (const s of list) if ((await subscriberId(s.email)) !== id) keep.push(s);
	if (keep.length === list.length) return false;
	await save(repo, keep);
	return true;
}

type MailEnv = Pick<Env, 'NOTIFY_FROM' | 'APP_URL'> & { EMAIL?: SendEmail };

export function sendingStatus(env: MailEnv): NotifyStatus['sending'] {
	if (!env.EMAIL) return 'no_binding';
	if (!env.NOTIFY_FROM || !isValidEmail(env.NOTIFY_FROM.trim())) return 'no_sender';
	return 'ready';
}

export interface Mail {
	subject: string;
	text: string;
	html: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface NewDataInfo {
	vehicleName: string;
	modelYear: string;
	brand: string;
	counts: { trims: number; colors: number; options: number; rules: number; review: number };
	jobId: string;
	replaced: boolean;
}

export function newDataMail(info: NewDataInfo, appUrl?: string): Mail {
	const title = `${info.brand ? `${info.brand} ` : ''}${info.vehicleName}${info.modelYear ? ` ${info.modelYear}년` : ''}`;
	const c = info.counts;
	const summary = `트림 ${c.trims} · 선택 품목 ${c.options} · 색상 ${c.colors} · 옵션 규칙 ${c.rules}`;
	const review = c.review > 0 ? `확인이 필요한 항목이 ${c.review}개 있습니다.` : '모든 항목이 자동 확정되었습니다.';
	const lead = info.replaced ? '새 가격표가 나와 기존 정리 결과를 교체했습니다.' : '새 가격표를 정리했습니다.';
	const link = appUrl ? `${appUrl.replace(/\/$/, '')}/?v=${encodeURIComponent(info.jobId)}` : '';
	return {
		subject: `[TrimSheet] ${title} 가격 정보가 추가되었습니다`,
		text: [`${title}`, lead, summary, review, link && `보기: ${link}`].filter(Boolean).join('\n'),
		html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#111">
<p style="margin:0 0 4px;color:#3742fa;font-weight:600">TrimSheet</p>
<h1 style="margin:0 0 12px;font-size:20px">${esc(title)}</h1>
<p style="margin:0 0 8px">${esc(lead)}</p>
<p style="margin:0 0 8px">${esc(summary)}</p>
<p style="margin:0 0 16px">${esc(review)}</p>
${link ? `<p style="margin:0"><a href="${esc(link)}" style="display:inline-block;background:#3742fa;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">차종 정보 보기</a></p>` : ''}
<p style="margin:24px 0 0;font-size:12px;color:#888">TrimSheet 알림 설정에서 이 주소를 지우면 더 이상 받지 않습니다.</p>
</div>`,
	};
}

export function testMail(appUrl?: string): Mail {
	return {
		subject: '[TrimSheet] 알림 메일 테스트',
		text: `새 가격 정보가 추가되면 이 주소로 알림을 보내 드립니다.${appUrl ? `\n${appUrl}` : ''}`,
		html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6"><p style="color:#3742fa;font-weight:600">TrimSheet</p><p>새 가격 정보가 추가되면 이 주소로 알림을 보내 드립니다.</p></div>`,
	};
}

export interface SendReport {
	status: NotifyStatus['sending'];
	sent: number;
	failed: number;
}

/**
 * Sends one message per subscriber (recipients never see each other). Errors are logged and
 * counted, never thrown — e.g. an unverified destination on Workers Free.
 */
export async function sendToSubscribers(env: MailEnv, repo: SheetsRepo, mail: Mail): Promise<SendReport> {
	const status = sendingStatus(env);
	const list = await load(repo);
	if (status !== 'ready' || list.length === 0) return { status, sent: 0, failed: 0 };
	let sent = 0;
	let failed = 0;
	for (const s of list) {
		try {
			await env.EMAIL!.send({ from: { email: env.NOTIFY_FROM.trim(), name: 'TrimSheet' }, to: s.email, subject: mail.subject, text: mail.text, html: mail.html });
			sent++;
		} catch (err) {
			failed++;
			log('error', 'notify_email_failed', { to: maskEmail(s.email), message: err instanceof Error ? err.message : String(err) });
		}
	}
	return { status, sent, failed };
}
