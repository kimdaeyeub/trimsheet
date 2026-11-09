import { CheckCircle2, CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../../lib/cn'
import { TOOL_LABEL } from '../../../lib/labels'
import { Spinner } from '../../ui/Spinner'

export type ToolState = 'input-available' | 'output-available' | 'output-error'

export interface ToolPart {
  toolName: string
  toolCallId: string
  state: ToolState
  input: unknown
  output?: unknown
  errorText?: string
}

export function ToolShell({
  part,
  title,
  children,
  tone,
  progress,
}: {
  part: ToolPart
  title?: string
  children?: ReactNode
  tone?: 'normal' | 'warning' | 'danger' | 'success'
  progress?: string
}) {
  const running = part.state === 'input-available'
  const failed = part.state === 'output-error'
  const t = failed ? 'danger' : (tone ?? 'normal')
  return (
    <div
      className={cn(
        'my-2 rounded-xl border bg-white p-3 text-sm',
        t === 'danger' && 'border-danger-500/30 bg-danger-50/40',
        t === 'warning' && 'border-warning-500/30 bg-warning-50/50',
        t === 'success' && 'border-primary-200',
        t === 'normal' && 'border-gray-200',
      )}
    >
      <div className="flex items-center gap-2 font-medium text-gray-800">
        {running ? (
          <Spinner className="size-3.5 text-primary-500" label="실행 중" />
        ) : failed ? (
          <CircleAlert className="size-4 text-danger-500" aria-hidden />
        ) : (
          <CheckCircle2 className={cn('size-4', t === 'warning' ? 'text-warning-500' : 'text-primary-500')} aria-hidden />
        )}
        <span>{title ?? TOOL_LABEL[part.toolName] ?? part.toolName}</span>
        {running && progress && <span className="font-normal text-gray-500">· {progress}</span>}
      </div>
      {failed && <p className="mt-1.5 text-danger-700">{part.errorText || '도구 실행에 실패했습니다.'}</p>}
      {!failed && children && <div className="mt-2 text-gray-700">{children}</div>}
    </div>
  )
}
