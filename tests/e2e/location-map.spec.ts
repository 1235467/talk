import { expect, test } from 'playwright/test'

test('location map fills the viewport and supports themes and custom places', async ({ page }) => {
  await page.goto('/#/locations')
  await expect(page.getByRole('heading', { name: '地点' })).toBeVisible()
  await expect(page.getByTestId('location-map')).toBeVisible()
  await expect(page.getByRole('button', { name: '地图图例' })).toBeVisible()
  await expect(page.getByRole('button', { name: '回到当前位置' })).toBeVisible()

  const mapBox = await page.getByTestId('location-map').boundingBox()
  expect(mapBox?.height).toBeGreaterThan(600)

  await page.getByRole('button', { name: '地图管理' }).click()
  await expect(page.getByRole('heading', { name: '地图管理' })).toBeVisible()
  await page.getByRole('button', { name: /中世纪欧洲/ }).click()
  await page.getByRole('button', { name: '进入编辑模式' }).click()
  await expect(page.getByText('编辑模式：点地点修改，点空白处新增')).toBeVisible()

  await page.getByTestId('location-map').click({ position: { x: 120, y: 260 } })
  await expect(page.getByRole('heading', { name: '新增地点' })).toBeVisible()
  await page.getByPlaceholder('例如：魔法学院').fill('测试城堡')
  await page.getByPlaceholder('简单描述这个地点').fill('自动化测试创建的中世纪地点')
  await page.getByPlaceholder('搜索城堡、医院、书院……').fill('城堡')
  await page.getByTitle('中世纪 · 城堡').click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '测试城堡' })).toHaveCount(1)

  const saved = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts')
    const location = (await db.locations.toArray()).find((item) => item.name === '测试城堡')
    const map = await db.worldMaps.get('active')
    return { userCreated: location?.userCreated, iconId: location?.mapBinding?.iconId, themeId: map?.themeId }
  })
  expect(saved.userCreated).toBe(true)
  expect(saved.iconId).toBe('castle')
  expect(saved.themeId).toBe('medieval')
})
