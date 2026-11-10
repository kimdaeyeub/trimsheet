import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { NotifyStatus } from '@shared/types'
import { Info, Send, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { qk } from '../../lib/query'
import { Button, IconButton } from '../ui/Button'
import { ErrorNotice } from '../ui/ErrorNotice'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i

const SENDING_NOTE: Record<Exclude<NotifyStatus['sending'], 'ready'>, string> = {
  no_binding: '메일 발송 설정(Cloudflare Email Service)이 아직 연결되지 않았습니다. 주소는 저장되고, 설정을 마치면 그때부터 발송됩니다.',
  no_sender: '보내는 주소(NOTIFY_FROM)가 설정되지 않았습니다. 주소는 저장되고, 설정을 마치면 그때부터 발송됩니다.',
}

export function EmailNotifyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="새 데이터 이메일 알림">
      <Body />
    </Modal>
  )
}

function Body() {
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: qk.notify, queryFn: api.notify })
  const [email, setEmail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const setData = (d: NotifyStatus) => queryClient.setQueryData(qk.notify, d)
  const add = useMutation({
    mutationFn: api.addNotifyEmail,
    onSuccess: (d) => {
      setData(d)
      setEmail('')
      setMessage(d.added ? '등록했습니다. 새 차종 정보가 추가되면 메일을 보내 드립니다.' : '이미 등록된 주소입니다.')
    },
  })
  const remove = useMutation({ mutationFn: api.removeNotifyEmail, onSuccess: (d) => (setData(d), setMessage('삭제했습니다.')) })
  const test = useMutation({
    mutationFn: api.testNotify,
    onSuccess: (r) =>
      setMessage(
        r.sending !== 'ready'
          ? '발송 설정이 아직 없어 보내지 않았습니다.'
          : r.failed
            ? `${r.sent}곳에 보냈고 ${r.failed}곳은 실패했습니다. 무료 플랜에서는 Cloudflare에서 인증한 주소로만 보낼 수 있습니다.`
            : `${r.sent}곳에 테스트 메일을 보냈습니다.`,
      ),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    const v = email.trim()
    if (!EMAIL_RE.test(v)) {
      setFormError('이메일 주소 형식을 확인해 주세요.')
      return
    }
    setFormError(null)
    add.mutate(v)
  }

  const data = status.data
  const full = data ? data.subscribers.length >= data.max : false

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-gray-600">에이전트가 새 가격표를 정리해 구글 시트에 추가하면, 등록한 주소로 차종과 요약을 메일로 보내 드립니다.</p>

      {data && data.sending !== 'ready' && (
        <p className="flex gap-2 rounded-lg bg-warning-50 p-3 text-warning-700">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {SENDING_NOTE[data.sending]}
        </p>
      )}

      <form onSubmit={submit} noValidate className="flex flex-col gap-1.5">
        <label htmlFor="notify-email" className="font-medium text-gray-800">
          이메일 주소
        </label>
        <div className="flex gap-2">
          <input
            id="notify-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => (setEmail(e.target.value), setFormError(null))}
            placeholder="name@example.com"
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? 'notify-email-error' : undefined}
            disabled={full}
            className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 px-3 outline-none placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 aria-[invalid]:border-danger-500 disabled:bg-gray-50"
          />
          <Button type="submit" disabled={add.isPending || full}>
            {add.isPending ? <Spinner /> : '등록'}
          </Button>
        </div>
        {formError && (
          <p id="notify-email-error" className="text-danger-700">
            {formError}
          </p>
        )}
        {full && <p className="text-gray-500">최대 {data?.max}개까지 등록할 수 있습니다.</p>}
      </form>

      {add.isError && <ErrorNotice error={add.error} />}
      {remove.isError && <ErrorNotice error={remove.error} />}
      {test.isError && <ErrorNotice error={test.error} />}
      {message && (
        <p role="status" className="rounded-lg bg-primary-50 p-3 text-primary-700">
          {message}
        </p>
      )}

      <div>
        <h3 className="mb-2 font-medium text-gray-800">
          받는 주소 <span className="font-normal text-gray-400">{data?.subscribers.length ?? ''}</span>
        </h3>
        {status.isPending && <Spinner className="text-primary-500" />}
        {status.isError && <ErrorNotice error={status.error} onRetry={() => status.refetch()} />}
        {data && data.subscribers.length === 0 && <p className="text-gray-500">아직 등록된 주소가 없습니다.</p>}
        {data && data.subscribers.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {data.subscribers.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-1 pr-1 pl-3">
                <span className="flex-1 truncate font-mono text-gray-800">{s.masked}</span>
                <IconButton label={`${s.masked} 삭제`} onClick={() => remove.mutate(s.id)} disabled={remove.isPending}>
                  <Trash2 className="size-4" aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-400">화면에는 주소 일부만 표시합니다. 주소는 구글 시트의 숨김 탭(_설정)에 저장됩니다.</p>
      </div>

      <div className="flex justify-end border-t border-gray-100 pt-4">
        <Button variant="secondary" size="sm" onClick={() => (setMessage(null), test.mutate())} disabled={test.isPending || !data || data.subscribers.length === 0 || data.sending !== 'ready'}>
          {test.isPending ? <Spinner /> : <Send className="size-3.5" aria-hidden />}
          테스트 메일 보내기
        </Button>
      </div>
    </div>
  )
}
