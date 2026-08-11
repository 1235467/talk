import { useEffect, useState } from 'react'

/**
 * One-shot async query hook for NOT-YET-MIGRATED non-core feature data
 * (finance, inventory, career, scoped saves, aiTest). Migrated resources use
 * TanStack Query against the server instead. Until those features land on the
 * server this stays a plain fetch-on-mount hook with no live reactivity.
 */
export function useLocalQuery<T>(querier: () => Promise<T> | T, deps: readonly unknown[] = []): T | undefined {
  const [value, setValue] = useState<T>()
  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(querier)
      .then((next) => { if (!cancelled) setValue(() => next) })
      .catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
