import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { IconButton } from './Button'

/** Native <dialog> modal: focus trap, Esc to close, backdrop click closes. */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-2xl border border-gray-200 p-0 shadow-2xl backdrop:bg-black/30"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        <IconButton label="닫기" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">{footer}</div>}
    </dialog>
  )
}
