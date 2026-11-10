export const formatWon = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('ko-KR')}원`)

/** "41,250,000원" → "4,125만원" for compact summaries. */
export function formatManwon(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const man = v / 10_000
  return `${Number.isInteger(man) ? man.toLocaleString('ko-KR') : man.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원`
}

export function formatPriceRange(from: number | null, to: number | null): string {
  if (from === null) return '가격 정보 없음'
  return from === to || to === null ? formatManwon(from) : `${formatManwon(from)} ~ ${formatManwon(to)}`
}

/** Sheet timestamps are KST strings ("YYYY-MM-DD HH:mm:ss"). */
export function formatKstDate(s: string | undefined): string {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})/.exec(s) : null
  return m ? `${m[1]}.${m[2]}.${m[3]}` : ''
}

/** Comma list from the sheet → items. */
export const splitList = (s: string) =>
  s
    .split(/\s*,\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
