import { expect, test } from 'playwright/test'

test('large pixel map supports spaced custom places, notes, children and regeneration', async ({ page }) => {
  await page.goto('/#/locations')
  await expect(page.getByRole('heading', { name: '地点', exact: true })).toBeVisible()
  const mapView = page.getByTestId('location-map')
  await expect(mapView).toBeVisible()
  await expect(page.getByRole('button', { name: '地图图例' })).toBeVisible()
  await expect(page.getByRole('button', { name: '回到当前位置' })).toBeVisible()

  const initial = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts')
    const map = await db.worldMaps.get('active')
    const roots = (await db.locations.toArray()).filter((item) => item.mapBinding)
    return { width: map?.width, height: map?.height, generatorVersion: map?.generatorVersion, roots: roots.length, themes: map?.themeId }
  })
  expect(initial).toMatchObject({ width: 48, height: 48, generatorVersion: 3 })
  expect(initial.roots).toBeGreaterThan(20)

  await page.getByRole('button', { name: '地图管理' }).click()
  await expect(page.getByText('地图主题', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /重新生成并分配地点/ })).toBeVisible()
  await page.getByRole('button', { name: '进入编辑模式' }).click()
  await expect(page.getByText(/点空白格显示/)).toBeVisible()

  const box = await mapView.boundingBox()
  expect(box).toBeTruthy()
  let found = false
  for (let y = 130; y < (box?.height ?? 650) - 100 && !found; y += 70) {
    for (let x = 35; x < (box?.width ?? 390) - 35 && !found; x += 55) {
      await mapView.click({ position: { x, y } })
      found = await page.getByRole('button', { name: '在这里新增地点' }).isVisible().catch(() => false)
      const close = page.getByRole('heading', { name: '编辑地点' })
      if (!found && await close.isVisible().catch(() => false)) await page.getByRole('button').filter({ has: page.locator('svg') }).last().click().catch(() => undefined)
    }
  }
  expect(found).toBe(true)
  await page.getByRole('button', { name: '在这里新增地点' }).click()
  await expect(page.getByRole('heading', { name: '新增地点' })).toBeVisible()
  await page.getByPlaceholder('例如：星河公寓').fill('测试公寓')
  await page.getByPlaceholder('简单描述这个地点').fill('自动化测试创建的地点')
  await page.getByPlaceholder('记录这个地点的设定、用途或注意事项').fill('保留这条用户备注')
  await page.getByRole('button', { name: '住宅', exact: true }).click()
  await page.getByTitle('住宅 · 公寓').click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '测试公寓' })).toBeVisible()

  await page.getByRole('button', { name: '测试公寓' }).click()
  await page.getByRole('button', { name: '添加子地点' }).click()
  await page.getByPlaceholder('子地点名称').fill('天台花园')
  await page.getByPlaceholder('子地点描述').fill('公寓顶层的小花园')
  await page.getByRole('button', { name: '保存子地点' }).click()
  await expect(page.getByText('天台花园', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('button', { name: '完成编辑' }).click()

  await page.getByRole('button', { name: '地图管理' }).click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /重新生成并分配地点/ }).click()
  await expect(page.getByRole('heading', { name: '地图管理', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '地点', exact: true })).toBeVisible()

  const saved = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts')
    const all = await db.locations.toArray()
    const location = all.find((item) => item.name === '测试公寓')
    const children = all.filter((item) => item.parentId === location?.id)
    const roots = all.filter((item) => item.mapBinding)
    const validSpacing = roots.every((a, index) => roots.slice(index + 1).every((b) => Math.max(Math.abs(a.mapBinding!.x - b.mapBinding!.x), Math.abs(a.mapBinding!.y - b.mapBinding!.y)) >= 2))
    return { note: location?.note, iconId: location?.mapBinding?.iconId, childNames: children.map((item) => item.name), validSpacing }
  })
  expect(saved).toEqual({ note: '保留这条用户备注', iconId: 'apartment', childNames: ['天台花园'], validSpacing: true })
})
