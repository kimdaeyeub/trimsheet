import { useQuery } from '@tanstack/react-query'
import { Mail, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { VehicleBrowser } from './components/catalog/VehicleBrowser'
import { Logo } from './components/layout/Logo'
import { EmailNotifyModal } from './components/notify/EmailNotifyModal'
import { Button } from './components/ui/Button'
import { api } from './lib/api'
import { qk } from './lib/query'

export function App() {
  const health = useQuery({ queryKey: qk.health, queryFn: api.health, staleTime: 5 * 60_000 })
  const [notifyOpen, setNotifyOpen] = useState(false)
  // Hidden until mail can actually be sent (NOTIFY_FROM + EMAIL binding); appears on its own after setup.
  const notify = useQuery({ queryKey: qk.notify, queryFn: api.notify, staleTime: 5 * 60_000 })
  const emailReady = notify.data?.sending === 'ready'

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" aria-label="TrimSheet 처음 화면">
            <Logo />
          </a>
          <div className="flex items-center gap-2">
            {emailReady && (
              <Button variant="secondary" size="sm" onClick={() => setNotifyOpen(true)} aria-haspopup="dialog" aria-label="이메일 알림" className="whitespace-nowrap">
                <Mail className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">이메일 알림</span>
              </Button>
            )}
          </div>
        </div>
        {health.data && health.data.sheets !== 'ok' && (
          <div className="border-t border-warning-500/20 bg-warning-50 px-4 py-2 text-center text-sm text-warning-700">
            <TriangleAlert className="mr-1 inline size-4 align-[-3px]" aria-hidden />
            {health.data.sheets === 'not_configured'
              ? 'Google Sheets가 연결되지 않아 임시 데이터만 보입니다.'
              : 'Google Sheets에 연결하지 못했습니다. 백엔드 로그를 확인하세요.'}
          </div>
        )}
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <VehicleBrowser />
      </main>
      <EmailNotifyModal open={notifyOpen} onClose={() => setNotifyOpen(false)} />
    </div>
  )
}
