import { cn } from '../../lib/cn'

const STYLE: Record<string, { short: string; cls: string }> = {
  현대: { short: 'H', cls: 'bg-[#002c5f] text-white' },
  기아: { short: 'K', cls: 'bg-gray-900 text-white' },
  제네시스: { short: 'G', cls: 'bg-[#a36b4f] text-white' },
}

export function BrandMark({ brand, className }: { brand: string; className?: string }) {
  const s = STYLE[brand] ?? { short: brand.slice(0, 1) || '?', cls: 'bg-gray-200 text-gray-700' }
  return (
    <span
      title={brand}
      aria-label={brand}
      className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold', s.cls, className)}
    >
      {s.short}
    </span>
  )
}
