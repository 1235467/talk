import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'

/**
 * Live-query hook for dropped (Dexie-only) feature tables — finance, inventory,
 * career, scoped saves, aiTest, speechCache. Migrated resources use TanStack
 * Query against the server instead; this keeps the remaining local-only tables
 * reactive without pulling dexie-react-hooks back into pages/components.
 */
export function useLocalQuery<T>(querier: () => Promise<T> | T, deps: readonly unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>()
  useEffect(() => {
    const subscription = liveQuery(querier).subscribe({
      next: (next) => setValue(() => next),
      error: () => undefined,
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
