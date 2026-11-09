import { cn } from '../../lib/cn'

export function Spinner({ className, label = '불러오는 중' }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-label={label} className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent', className)} />
  )
}
