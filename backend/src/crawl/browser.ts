// Browser Run session helper (PLAN.md §5.2). Every session is closed in `finally`.
import { launch, type Page } from '@cloudflare/playwright';

/** Only the three manufacturer sites (plus their CDNs via subdomains) may be loaded. */
const ALLOWED = ['hyundai.com', '*.hyundai.com', 'kia.com', '*.kia.com', 'genesis.com', '*.genesis.com'];

export async function withPage<T>(binding: BrowserRun, fn: (page: Page) => Promise<T>): Promise<T> {
	const browser = await launch(binding as never, { keep_alive: 10_000, guardrails: { allowedDomains: ALLOWED } });
	try {
		const page = await browser.newPage();
		page.setDefaultNavigationTimeout(30_000);
		page.setDefaultTimeout(15_000);
		return await fn(page);
	} finally {
		await browser.close();
	}
}

/**
 * Record URLs the page tries to open (window.open / programmatic <a>.click / link clicks)
 * instead of navigating or downloading. Read them back with `readCaptured`.
 */
export const CAPTURE_SCRIPT = `(() => {
  if (window.__trimsheetCapture) return;
  window.__trimsheetCapture = [];
  const rec = (u) => { try { window.__trimsheetCapture.push(new URL(String(u), location.href).href); } catch (e) {} };
  window.open = (u) => { rec(u); return null; };
  HTMLAnchorElement.prototype.click = function () { if (this.href && !this.href.startsWith('javascript')) rec(this.href); };
  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a && a.href && /\\.pdf($|\\?)/i.test(a.href)) { rec(a.href); e.preventDefault(); }
  }, true);
})()`;
