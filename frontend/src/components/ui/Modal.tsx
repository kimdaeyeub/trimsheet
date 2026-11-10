import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { IconButton } from './Button'

/** Native <dialog>: focus trap, Esc to close and the backdrop come from the browser. */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
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
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (e.target === ref.current) onClose()
      }}
      aria-labelledby="modal-title"
      className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-gray-900/40"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h2 id="modal-title" className="font-semibold">
          {title}
        </h2>
        <IconButton label="닫기" onClick={onClose}>
          <X className="size-4" aria-hidden />
        </IconButton>
      </div>
      <div className="p-5">{open && children}</div>
    </dialog>
  )
}
