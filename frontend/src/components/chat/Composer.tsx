import { FileText, Paperclip, SendHorizontal, X } from 'lucide-react'
import { useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'
import { formatBytes, validatePdf } from '../../lib/format'
import { Button, IconButton } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

export function Composer({
  onSubmit,
  busy,
  busyLabel = '작업 중…',
  placeholder = '가격표 PDF를 올리거나, 제조사 PDF 링크를 붙여 넣으세요.',
  autoFocus,
  large,
}: {
  onSubmit: (text: string, file: File | null) => Promise<void> | void
  busy?: boolean
  busyLabel?: string
  placeholder?: string
  autoFocus?: boolean
  large?: boolean
}) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [sending, setSending] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const disabled = busy || sending

  const pick = (f: File | undefined) => {
    if (!f) return
    const err = validatePdf(f)
    setError(err)
    if (!err) setFile(f)
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (disabled || (!text.trim() && !file)) return
    setSending(true)
    setError(null)
    try {
      await onSubmit(text.trim() || (file ? '이 가격표를 정리해 줘' : ''), file)
      setText('')
      setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '보내지 못했습니다.')
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files[0])
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-2xl border bg-white shadow-sm transition-colors',
        dragging ? 'border-primary-500 bg-primary-50' : 'border-gray-200 focus-within:border-primary-300',
      )}
    >
      {file && (
        <div className="flex items-center gap-2 px-3 pt-3">
          <span className="flex items-center gap-2 rounded-lg bg-primary-50 px-2.5 py-1.5 text-sm text-primary-800">
            <FileText className="size-4" aria-hidden /> {file.name}
            <span className="text-primary-500">{formatBytes(file.size)}</span>
            <button type="button" aria-label="첨부 취소" onClick={() => setFile(null)} className="rounded p-0.5 hover:bg-primary-100">
              <X className="size-3.5" />
            </button>
          </span>
        </div>
      )}
      <textarea
        aria-label="메시지"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={dragging ? '여기에 PDF를 놓으세요' : placeholder}
        rows={large ? 3 : 1}
        className={cn('block w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-gray-400', large ? 'min-h-20' : 'max-h-40')}
      />
      <div className="flex items-center gap-2 px-2 pb-2">
        <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ''))} />
        <IconButton label="PDF 첨부" onClick={() => input.current?.click()} disabled={disabled}>
          <Paperclip className="size-5" />
        </IconButton>
        {error && <p className="flex-1 text-sm text-danger-700" role="alert">{error}</p>}
        <span className="ml-auto" />
        {disabled ? (
          <span className="flex items-center gap-2 pr-2 text-sm text-gray-500">
            <Spinner className="size-3.5 text-primary-500" /> {sending && file ? 'PDF 올리는 중…' : busyLabel}
          </span>
        ) : (
          <Button type="submit" size="sm" disabled={!text.trim() && !file} aria-label="보내기">
            <SendHorizontal className="size-4" aria-hidden /> 보내기
          </Button>
        )}
      </div>
    </form>
  )
}
