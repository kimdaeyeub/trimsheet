import { useQuery } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { qk } from '../../../lib/query'

export const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
export const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/** Live progress note for a running tool that works on a job (R2 only — no Sheets calls). */
export function useJobProgress(jobId: string | undefined, running: boolean) {
  const q = useQuery({
    queryKey: qk.jobState(jobId ?? ''),
    queryFn: () => api.jobState(jobId!),
    enabled: Boolean(jobId) && running,
    refetchInterval: running ? 2000 : false,
    staleTime: 0,
  })
  return running ? q.data?.progressNote : undefined
}

