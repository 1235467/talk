# Talk — AI 聊天软件项目记忆

## 架构（2026-08 服务器化改造后的现状，旧文档全部作废）

**唯一数据源在服务器**。没有多端同步问题，因为数据只有一份：

```
浏览器 / Android(Capacitor 壳)  ──→  VPS: talk-server (axum + sqlx + SQLite)
                                      ├── talk.db   ← 全部数据，备份=拷文件
                                      └── media/    ← 图片/语音文件
```

- **后端**（`server/`）：Rust 单二进制，clap 子命令 `serve` / `db migrate` / `import <backup.json>` / `stats`。启动时自动跑 `sqlx::migrate!()`。鉴权 = 单用户 bearer token（`TALK_TOKEN`）。构建走 `server/flake.nix`（Crane + SQLX_OFFLINE），部署参考 `server/deploy/nginx.conf.template`，**无 Docker 无 Caddy**。
- **前端**（`src/`）：Vite + React + TS，原有代码 90% 保留。持久层已从 Dexie/IndexedDB 整体换成 REST + TanStack Query；**IndexedDB 已彻底删除**（dexie 依赖都没了）。
- 参考实现约定：形态抄 wastebin、SQLite 运维抄 lrclib、sqlx 工作流抄 synctv。

## 前端关键层

- `src/lib/api/client.ts` — `apiFetch`（base URL + Bearer token 从设置读）、`getOrUndef`（404→undefined，Dexie get 语义）、`hasAiAccess`、`outboundFetch`（第三方 provider 请求走服务器代理）、`mediaUrl`。
- `src/lib/api/resources.ts` — 类型化资源（`api.contacts.list({worldviewId})`、`api.messages.list({conversationId, before, limit})`、`api.presets`、`api.kv`、`api.batch.*`、`api.media.upload`、`api.backup.export/import`）。过滤参数用 camelCase JSON 字段名；数组包含查询用 `field_contains` 后缀。
- `src/lib/api/keys.ts` — `queryClient`、`invalidate(...资源名)`、`invalidateAll()`。**写操作后必须 invalidate 对应资源名**（queryKey 首元素 = 资源名，如 `['messages', conversationId]`）。
- 非 React 的 lib 代码（引擎等）直接 `await api.X` + `invalidate()`；组件用 `useQuery` + mutation。

## 请求路径（设备端唯一秘密 = server token）

- AI 聊天：`deepseek.ts` → `/api/ai-proxy`。客户端算出目标 URL（provider adapter），**key 由服务器每次现读 kv 的 `apiKey`**——任何设备在设置页改 key/端点即时全局生效。**没有 TALK_AI_* 环境变量**。
- 第三方（Pexels/Tavily/Giphy/生图/TTS）：`outboundFetch` → `/api/outbound`（SSRF 防护的通用转发）。key 同样走 kv 同步。
- 媒体：合成图/语音 → `api.media.upload(dataUrl)` → 服务器存文件返回 `/media/<file>`。

## 设置同步模型

**默认全同步**（黑名单制）：`useSettingsStore.setSettings` 会把 patch 里除 `DEVICE_ONLY_KEYS`（`serverUrl`/`serverToken`/`topInsetAdjustmentPx`）外的所有键写入服务器 kv；启动时 `hydrateSettingsFromServer()` 拉回全部 kv 覆盖本地。zustand persist 的 localStorage 只是本地缓存。新增设置键时不用管同步——自动生效，除非它真的是设备相关（那就加进 DEVICE_ONLY_KEYS）。

## 提示词系统（两层，旧三层快照已删除）

- `prompt_presets` 表：`出厂默认`（is_factory，只读，hydrate 时从代码播种）+ 用户命名预设（重名创建会 409）。
- `Contact.presetName` **按名动态引用**：构建提示词时 `resolveContactPromptModules(contact, settings)` 现查预设内容。原地保存预设 → 所有引用者下一轮生效；另存为新名 → 老引用不动。
- 老数据的 `promptModulesSnapshot` 由**服务器 import 时**转成共享命名预设（`迁移快照`），客户端没有任何快照兜底逻辑。
- `GlobalPromptModulesPage` = 预设管理（原地保存/另存为/删除/应用到联系人/设为新联系人默认 `settings.defaultPresetName`）。

## 非核心功能（休眠，不是删除）

shop/warehouse/inventory、career/jobs、scopedSaves（存档）、aiTest 框架：**代码保留**但模块在 `enabledModules` 里被禁用，数据不迁移。它们的 db 引用指向 `src/db/unmigrated.ts`（调用即抛"尚未迁移"的 stub），文件带 `@ts-nocheck`、对应测试 `describe.skip`。恢复路径：服务器补表 → api 资源 → 启用模块。迁移时金融/职业上下文在引擎里本来就受模块门控（`isModuleEnabled('career')`），禁用后自动跳过。

**finance/wallet/loans 已迁移（2026-08）**：表 = `wallet_accounts`/`wallet_transactions`（幂等键唯一索引）/`loans`；余额变动和日薪必须走原子端点 `POST /api/finance/{ensure,transfer,claim-red-packet,claim-daily-salaries}`（`routes/finance.rs`，客户端封装在 `lib/finance.ts`），不要客户端多步读写余额。finance 不是模块——它的 UI（ChatPage 转账/红包/借款、MePage 工资）仍由 career/shop/warehouse 模块门控，随它们的迁移解锁。删联系人会级联清钱包/交易/贷款（batch）。

## 测试

- `npx vitest run` — `src/test/setup.ts` 在 `apiFetch` 单点 mock 了一个内存版假服务器（完整语义：过滤/contains/patch/级联/导入导出），`resetFakeServer()` 重置。新测试种数据用 `api.X.put`，不要引用 Dexie。
- `npx tsc -b` 必须干净。`npm run lint`（type-aware）**在 Termux 上跑不了**（缺 `@oxlint-tsgolint/android-arm64`），用 `npx oxlint` 代替。
- **sqlx migrate! 是编译期内嵌**：新增 migration 文件后 `cargo build` 可能不感知，需 `touch src/db.rs`（或随便一个源文件）触发重编。

## 服务器开发

- 表结构约定：真实列只放过滤/排序字段 + `data` JSON 列存完整对象（API 原样返回 data，前端类型直通）；id 数组字段（contactIds/memberContactIds/keywords 等 8 处）镜像到 join 表供 `_contains` 查询。
- 多表原子操作做成批处理端点（`routes/batch.rs`：删联系人/朋友圈/消息的级联），不要让客户端顺序调。
- CRUD 是宏生成的（`crud.rs` + `resources.rs` 声明式注册），加新表 = 一个 migration + 一个 `crud_routes!` + mount + `import_order()` 加映射。

## 开发命令

- 前端：`npm run dev` / `npx tsc -b` / `npx oxlint` / `npx vitest run`
- 后端：`cd server && cargo build` / `TALK_TOKEN=xxx ./target/debug/talk-server serve` / `nix build`（在 NixOS 上）
