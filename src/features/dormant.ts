/**
 * Non-core features whose code is kept but whose data has not migrated to the
 * server yet. Their module ids are stripped from enabledModules everywhere
 * (persist migration + kv hydration) so featureActive() can never resurrect
 * their db calls. When a feature migrates, remove its id here and enable it.
 *
 * Kept in its own dependency-free module because useSettingsStore and
 * features/index import each other.
 */
export const DORMANT_MODULES = new Set(['career', 'saveLoad'])

export function filterDormantModules(ids: string[]): string[] {
  return ids.filter((id) => !DORMANT_MODULES.has(id))
}
