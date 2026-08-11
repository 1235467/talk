# TODO

**优先级原则**：死代码清理与休眠功能迁移最高优先 → 删除不迁移、媒体文件化等稳定化工作次之 → 打磨再次 → 新功能（架构二期）在稳定之后。

## 1. 死代码清理（最高优先级；与 0.1.51 功能对等）

逐项证据、master 交叉验证与精确删除边界见 [DEADCODE-CLEANUP.md](./DEADCODE-CLEANUP.md)。

- [ ] ContactAddPage：3 个恒假女娲区块 + 3 个特质编辑器死函数（`customTraits` 接线保留）
- [ ] ContactCardPage：`ScheduleWeekTimeline` 死组件 + 私有 helpers + `moodEnabled` 硬编码
- [ ] features/index.ts：`getEnabled*` 死导出（`linkApps` 声明保留）
- [ ] 14 个 lib 文件的 20 个零引用导出
- [ ] Avatar 死 props、types 的 `PersonalityTrait`
- [ ] 验证：`tsc -b` / `oxlint` / `vitest run` 全绿

## 2. 休眠功能迁移（最高优先级；在清理之后做，按下列顺序）

每个功能固定路径：server schema（migration + crud_routes! + import_order 从 SKIPPED_TABLES 移入）→ fake server → lib 转 api → DORMANT_MODULES 删除 → 启用模块

1. **finance**（walletAccounts/walletTransactions/loans；幂等键防重必须保留；chatEngine 转账气泡、MePage 工资都等它；迁移时顺带消除 DEADCODE-CLEANUP.md「不删清单」里登记的 5 处假 bug）
2. **shop/warehouse**（inventory/shopPurchaseHistory；依赖 finance；若要恢复"AI 发小程序链接"，需把 linkApps 过滤逻辑重新接进提示词构建——该注入 0.1.51 前已失，非对等要求）
3. **career**（jobListings/interviews；联系人 occupation/工资字段已在）
4. **scopedSaves 存档**（contactStorylines/contactSaveSnapshots/globalSaveSnapshots/saveSlots；多表快照做成批处理端点）

## 3. 删除不迁移（稳定化）

- [ ] **aiTest 框架**（aiTestSuites/adminLogs/adminAiTraces + aiTestCards.ts/aiTestManager.ts/AiTestCardsPage + 相关路由）：管理员的提示词回归测试沙盒，确认无用后整删，consoleCapture 保持内存版；连带 types 的 `AdminLogRecord`

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
