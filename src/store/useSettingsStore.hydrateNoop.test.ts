import { describe, expect, it } from 'vitest'
import { resetFakeServer } from '../test/setup'
import { hydrateSettingsFromServer, useSettingsStore } from './useSettingsStore'

describe('hydrateSettingsFromServer (unconfigured)', () => {
  it('no-ops without a configured server', async () => {
    resetFakeServer()
    expect(await hydrateSettingsFromServer()).toBe(-1)
    expect(useSettingsStore.getState().serverUrl).toBe('')
  })
})
