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
  catalog: (page: number, pageSize: number, brand: string, q: string) => ['catalog', page, pageSize, brand, q] as const,
  vehicle: (id: string) => ['vehicle', id] as const,
  notify: ['notify'] as const,
}
