/** Page numbers with ellipses: 1 … 4 5 [6] 7 8 … 20 */
export function pageItems(page: number, totalPages: number): (number | 'gap')[] {
  const keep = new Set([1, totalPages, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => keep.add(p))
  if (page >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => keep.add(p))
  const pages = [...keep].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  pages.forEach((p, i) => {
    // A gap hiding a single page shows that page instead ("1 2 3", not "1 … 3").
    if (i > 0 && p - pages[i - 1] === 2) out.push(p - 1)
    else if (i > 0 && p - pages[i - 1] > 2) out.push('gap')
    out.push(p)
  })
  return out
}
