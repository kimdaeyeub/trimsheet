import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/cn'
import { pageItems } from '../../lib/pagination'

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  const base = 'inline-flex size-9 items-center justify-center rounded-lg text-sm font-medium tabular-nums transition-colors'
  return (
    <nav aria-label="페이지" className="flex items-center justify-center gap-1">
      <button type="button" className={cn(base, 'text-gray-600 hover:bg-gray-100 disabled:opacity-30')} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="이전 페이지">
        <ChevronLeft className="size-4" aria-hidden />
      </button>
      {pageItems(page, totalPages).map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="w-6 text-center text-gray-400" aria-hidden>
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={cn(base, p === page ? 'bg-primary-500 text-white' : 'text-gray-700 hover:bg-gray-100')}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" className={cn(base, 'text-gray-600 hover:bg-gray-100 disabled:opacity-30')} disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="다음 페이지">
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </nav>
  )
}
