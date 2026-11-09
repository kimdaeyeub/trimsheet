import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatKst } from '../../lib/format'
import { qk } from '../../lib/query'
import { IconButton } from '../ui/Button'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: qk.notifications, queryFn: api.notifications, refetchInterval: 60_000 })
  const read = useMutation({
    mutationFn: api.readNotification,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const unread = data?.unread ?? 0
  return (
    <div ref={ref} className="relative">
      <IconButton label={unread ? `알림 ${unread}개` : '알림'} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-xl border border-gray-200 bg-white shadow-xl">
          <p className="border-b border-gray-100 px-4 py-3 text-sm font-semibold">알림</p>
          <ul className="max-h-96 overflow-y-auto" aria-live="polite">
            {!data?.items.length && <li className="px-4 py-8 text-center text-sm text-gray-400">알림이 없습니다.</li>}
            {data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className={cn('block w-full px-4 py-3 text-left hover:bg-gray-50', !n.read && 'bg-primary-50/50')}
                  onClick={() => {
                    if (!n.read) read.mutate(n.id)
                    setOpen(false)
                    if (n.jobId) navigate(`/jobs/${n.jobId}`)
                  }}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    {!n.read && <span className="size-1.5 rounded-full bg-primary-500" aria-label="안 읽음" />}
                    {n.title}
                  </span>
                  {n.body && <span className="mt-0.5 block text-xs text-gray-500">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-gray-400">{formatKst(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
