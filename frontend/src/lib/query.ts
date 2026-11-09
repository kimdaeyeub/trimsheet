import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sheet-backed data: each read is a Google Sheets API call, so keep it for a while.
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

export const qk = {
  health: ['health'] as const,
  settings: ['settings'] as const,
  conversations: ['conversations'] as const,
  jobs: (conversationId?: string) => ['jobs', conversationId ?? 'all'] as const,
  job: (id: string) => ['job', id] as const,
  jobState: (id: string) => ['jobState', id] as const,
  notifications: ['notifications'] as const,
  vehicles: ['vehicles'] as const,
  scanRuns: ['scanRuns'] as const,
}
