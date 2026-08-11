# TODO

**优先级原则**：死代码清理与休眠功能迁移最高优先 → 删除不迁移、媒体文件化等稳定化工作次之 → 打磨再次 → 新功能（架构二期）在稳定之后。

## 1. 死代码清理（最高优先级；与 0.1.51 功能对等）

逐项证据、master 交叉验证与精确删除边界见 [DEADCODE-CLEANUP.md](./DEADCODE-CLEANUP.md)。

- [x] ContactAddPage：3 个恒假女娲区块 + 3 个特质编辑器死函数（`customTraits` 接线保留）
- [x] ContactCardPage：`ScheduleWeekTimeline` 死组件 + 私有 helpers + `moodEnabled` 硬编码
- [x] features/index.ts：`getEnabled*` 死导出（`linkApps` 声明保留）
- [x] 14 个 lib 文件的 20 个零引用导出
- [x] Avatar 死 props、types 的 `PersonalityTrait`
- [x] 验证：`tsc -b` / `oxlint` / `vitest run` 全绿（37 文件通过 / 171 测试通过）

## 2. 休眠功能迁移（最高优先级；在清理之后做，按下列顺序）

每个功能固定路径：server schema（migration + crud_routes! + import_order 从 SKIPPED_TABLES 移入）→ fake server → lib 转 api → DORMANT_MODULES 删除 → 启用模块

1. [x] **finance**（walletAccounts/walletTransactions/loans；2026-08 完成：0006_finance.sql + `/api/finance/*` 原子端点（幂等键保留）+ lib/finance.ts 转 api；5 处假 bug 已消（ContactAdminPage saveAll、backup restore、App.tsx ensureWallets、MePage/DesktopLayout 死查询、SettingsPage 余额区）；chatEngine 转账气泡已接线但仍由 career 模块门控）
2. [x] **shop/warehouse**（inventory/shopPurchaseHistory；2026-08 完成：0007_shop.sql + `/api/finance/purchase` 原子购买端点 + inventory.ts 转 api；模块已重新启用（DORMANT_MODULES 移除 shop/warehouse）；linkApps 提示词注入恢复仍是可选增强，见下）
3. [x] **career**（jobListings/interviews；2026-08 完成：0008_career.sql + 纯 CRUD + WorkPage/InterviewPage 转 api；career 模块重新启用，ChatPage 金融簇/工资/职业行/引擎金钱气泡同步解锁）
4. [x] **scopedSaves 存档**（2026-08 完成：0009_scoped_saves.sql + `/api/saves/{restore-contact,restore-global,switch-worldview}` 多表原子端点 + scopedSaves.ts/SaveLoadPage 转 api；saveLoad 模块重新启用——DORMANT_MODULES 已清空；saveSlots 无任何消费方，保持 SKIPPED 待随 aiTest 期清理；新增 scopedSaves.test.ts 6 例）

## 3. 删除不迁移（稳定化）

- [x] **aiTest 框架**（2026-08 整删：aiTestCards.ts/aiTestManager.ts/AiTestCardsPage + 2 个专属测试 + /ai-test-cards 路由 + DiscoverPage 入口 + ChatPage 重定向 + 7 个类型（含 AdminLogRecord）+ backup.ts 清单清理；保留 aiTestIsolation.ts 前缀过滤（18+ 活跃文件在用）和 consoleCapture 内存版；`db/unmigrated.ts` 随之删除——休眠机制落幕；服务器 SKIPPED_TABLES 保留 adminLogs/adminAiTraces/aiTestSuites/saveSlots 名字作永不导入标记）

## 4. 媒体文件化（稳定化；media/ 目录已建，目前只接了 TTS）

- [ ] 新生成内容落文件：imageAssets.persistResult / 贴纸下载 / 头像 存 dataUrl → api.media.upload，行里只留 URL
- [ ] 存量迁移脚本：messages/stickers/mediaAssets/moments 里的 base64 dataUrl 转存 media/ 文件并更新行
- [ ] 媒体文件 GC：记录删除时的孤儿文件清理（目前只有 speech 文件跟着删）

## 5. 打磨（其次）

- [ ] `listModels`（拉模型）走代理——现在直连 provider，浏览器同源流会撞 CORS
- [ ] 全量 wipe 端点（现在客户端逐表删，漏 kv/presets/speech）
- [ ] 出厂预设更新策略：app 升级带新模板时怎么刷新只读预设
- [ ] 引擎层 orchestration 单测
- [ ] `next` 分支版本号/versionCode 策略（与 master 0.1.51 线分开）

## 6. 架构二期（新功能，稳定后再做）

- [ ] **Tauri 2**：手机 + 桌面统一壳（Electron/RN 均不做），server.url 指向服务器后 app 免更新
- [ ] **服务端 AI turn 编排**：POST /conversations/:id/turns + SSE；引擎挪服务端后才有"app 关着 AI 也在生活", 以及误关闭/app后台被杀继续生成文本
