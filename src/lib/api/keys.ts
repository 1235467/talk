import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
    },
  },
})

/** Invalidate every query touching the given server resources. */
export function invalidate(...tables: string[]) {
  void queryClient.invalidateQueries({
    predicate: (query) => tables.some((table) => query.queryKey[0] === table),
  })
}

/** Nuclear option for batch endpoints and imports that touch many tables. */
export function invalidateAll() {
  void queryClient.invalidateQueries()
}
