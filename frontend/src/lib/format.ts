export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const formatWon = (v: string | number | null | undefined) => {
  if (v === null || v === undefined || v === '') return '—'
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toLocaleString('ko-KR')}원` : String(v)
}

/** Sheet timestamps are already KST strings ("YYYY-MM-DD HH:mm:ss"); show a compact form. */
export function formatKst(s: string | undefined): string {
  if (!s) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s)
  if (!m) return s
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  return `${m[1]}-${m[2]}-${m[3]}` === today ? `오늘 ${m[4]}:${m[5]}` : `${m[2]}.${m[3]} ${m[4]}:${m[5]}`
}

/** Tokens the frontend adds to user messages for the agent (see backend system prompt). */
export const TOKEN_RE = /\[(source|conversation|file):([^\]]+)\]/g

export function stripTokens(text: string): { text: string; source?: string; file?: string } {
  let source: string | undefined
  let file: string | undefined
  const clean = text.replace(TOKEN_RE, (_m, kind: string, value: string) => {
    if (kind === 'source') source = value
    if (kind === 'file') file = decodeURIComponent(value)
    return ''
  })
  return { text: clean.replace(/\s+$/g, '').trim(), source, file }
}

export function withTokens(text: string, opts: { sourceId?: string; filename?: string; conversationId: string }): string {
  const parts = [text.trim()]
  if (opts.sourceId) parts.push(`[source:${opts.sourceId}]`)
  if (opts.filename) parts.push(`[file:${encodeURIComponent(opts.filename)}]`)
  parts.push(`[conversation:${opts.conversationId}]`)
  return parts.join(' ')
}

export function validatePdf(file: File): string | null {
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'PDF 파일만 올릴 수 있습니다.'
  if (file.size > MAX_UPLOAD_BYTES) return `PDF는 50MB 이하만 올릴 수 있습니다. (현재 ${formatBytes(file.size)})`
  return null
}
