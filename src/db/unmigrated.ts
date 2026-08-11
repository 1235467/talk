/**
 * Stand-in for the deleted Dexie database, kept only so the code of
 * deliberately-disabled features (shop/finance/career/scoped-saves/ai-test)
 * still compiles. Their tables are not part of the server schema yet; any
 * actual call means someone enabled the feature without migrating it.
 */

function unmigrated(table: string): never {
  throw new Error(`功能 "${table}" 尚未迁移到服务器（该模块当前处于禁用状态）`)
}

const tableProxy = new Proxy({} as Record<string, unknown>, {
  get: (_target, table: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_tableTarget, method: string) => () => unmigrated(`${table}.${method}`),
    }),
})

/* eslint-disable @typescript-eslint/no-explicit-any */
export const db: any = new Proxy({} as Record<string, unknown>, {
  get: (_target, key: string) => {
    if (key === 'transaction') return () => unmigrated('transaction')
    return tableProxy[key]
  },
})
