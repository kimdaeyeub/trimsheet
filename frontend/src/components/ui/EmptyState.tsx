import type { ReactNode } from 'react'

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      {icon && <div className="mb-1 text-gray-300">{icon}</div>}
      <p className="font-semibold text-gray-800">{title}</p>
      {children && <div className="max-w-md text-sm text-gray-500">{children}</div>}
    </div>
  )
}
