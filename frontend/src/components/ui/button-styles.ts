import { cn } from '../../lib/cn'

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type Size = 'sm' | 'md'

export const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary-500 text-white hover:bg-primary-600 disabled:bg-primary-300',
  secondary: 'bg-white text-gray-800 border border-gray-200 hover:bg-gray-50 disabled:text-gray-400',
  ghost: 'text-gray-700 hover:bg-gray-100 disabled:text-gray-300',
  danger: 'bg-white text-danger-700 border border-danger-500/30 hover:bg-danger-50',
}
export const SIZE: Record<Size, string> = { sm: 'h-8 px-3 text-sm gap-1.5', md: 'h-10 px-4 text-sm gap-2' }

/** Class names for links that should look like buttons (avoids <button> inside <a>). */
export const buttonClass = (variant: Variant = 'primary', size: Size = 'md', extra?: string) =>
  cn('inline-flex items-center justify-center rounded-lg font-medium transition-colors', VARIANT[variant], SIZE[size], extra)

