# TODO

## B. 媒体文件化（media/ 目录已建，目前只接了 TTS）

- [ ] 新生成内容落文件：imageAssets.persistResult / 贴纸下载 / 头像 存 dataUrl → api.media.upload，行里只留 URL
- [ ] 存量迁移脚本：messages/stickers/mediaAssets/moments 里的 base64 dataUrl 转存 media/ 文件并更新行
- [ ] 媒体文件 GC：记录删除时的孤儿文件清理（目前只有 speech 文件跟着删）

## C. 休眠功能迁移（优先级从上到下）

每个功能固定路径：server schema（migration + crud_routes! + import_order 从 SKIPPED_TABLES 移入）→ fake server → lib 转 api → DORMANT_MODULES 删除 → 启用模块

1. **finance**（walletAccounts/walletTransactions/loans；幂等键防重必须保留；chatEngine 转账气泡、MePage 工资都等它）
2. **shop/warehouse**（inventory/shopPurchaseHistory；依赖 finance）
3. **career**（jobListings/interviews；联系人 occupation/工资字段已在）
4. **scopedSaves 存档**（contactStorylines/contactSaveSnapshots/globalSaveSnapshots/saveSlots；多表快照做成批处理端点）

## D. 删除不迁移

- [ ] **aiTest 框架**（aiTestSuites/adminLogs/adminAiTraces + aiTestCards.ts/aiTestManager.ts/AiTestCardsPage + 相关路由）：管理员的提示词回归测试沙盒，确认无用后整删，consoleCapture 保持内存版

## E. 架构二期

- [ ] **Tauri 2**：手机 + 桌面统一壳（Electron/RN 均不做），server.url 指向服务器后 app 免更新
- [ ] **服务端 AI turn 编排**：POST /conversations/:id/turns + SSE；引擎挪服务端后才有"app 关着 AI 也在生活"

## F. 打磨

- [ ] `listModels`（拉模型）走代理——现在直连 provider，浏览器同源流会撞 CORS
- [ ] 全量 wipe 端点（现在客户端逐表删，漏 kv/presets/speech）
- [ ] 出厂预设更新策略：app 升级带新模板时怎么刷新只读预设
- [ ] 引擎层 orchestration 单测
- [ ] `next` 分支版本号/versionCode 策略（与 master 0.1.51 线分开）
