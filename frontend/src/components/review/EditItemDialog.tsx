import { useState, type FormEvent } from 'react'
import type { SheetName } from '@shared/types'
import { EDIT_FIELDS } from '../../lib/review'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'

export interface EditTarget {
  sheet: SheetName
  itemId: string
  values: Record<string, string>
  /** Human-readable pass A / pass B values from the 확인필요 tab, when available. */
  passA?: string
  passB?: string
  reasons?: string
}

export function EditItemDialog({
  target,
  onClose,
  onSave,
  saving,
  error,
}: {
  target: EditTarget
  onClose: () => void
  onSave: (data: Record<string, string>) => void
  saving: boolean
  error?: string | null
}) {
  const fields = EDIT_FIELDS[target.sheet]
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, target.values[f.key] ?? ''])))
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== (target.values[k] ?? '')))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (Object.keys(changed).length) onSave(changed)
    else onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="항목 수정"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button type="submit" form="edit-item" disabled={saving}>
            {saving ? '저장 중…' : Object.keys(changed).length ? '수정해서 저장' : '닫기'}
          </Button>
        </>
      }
    >
      {(target.passA || target.passB) && (
        <div className="mb-4 grid gap-2 rounded-lg bg-gray-50 p-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500">1차 추출</p>
            <p className="font-medium">{target.passA || '없음'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">2차 추출</p>
            <p className="font-medium">{target.passB || '없음'}</p>
          </div>
          {target.reasons && <p className="text-xs text-warning-700 sm:col-span-2">사유: {target.reasons}</p>}
        </div>
      )}
      <form id="edit-item" onSubmit={submit} className="space-y-3">
        {fields.map((f) => {
          const id = `f-${f.key}`
          const common = {
            id,
            value: form[f.key],
            onChange: (e: { target: { value: string } }) => setForm((s) => ({ ...s, [f.key]: e.target.value })),
            className: 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary-400',
          }
          return (
            <div key={f.key}>
              <label htmlFor={id} className="mb-1 flex items-center justify-between text-sm font-medium text-gray-700">
                {f.label}
                {f.hint && <span className="text-xs font-normal text-gray-400">{f.hint}</span>}
              </label>
              {f.kind === 'select' ? (
                <select {...common}>
                  {f.options!.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.kind === 'textarea' ? (
                <textarea rows={3} {...common} />
              ) : f.kind === 'color' ? (
                <div className="flex items-center gap-2">
                  <span className="size-9 shrink-0 rounded-lg border border-gray-200" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(form[f.key]) ? form[f.key] : 'transparent' }} aria-hidden />
                  <input {...common} placeholder="#EDEBE4" />
                </div>
              ) : (
                <input {...common} inputMode={f.kind === 'price' ? 'numeric' : undefined} />
              )}
            </div>
          )
        })}
        {error && (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
