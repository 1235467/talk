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
- 媒体：一切本地产生的媒体（生图/贴纸/头像/封面/语音）→ `api.media.upload(dataUrl)` → 服务器存文件返回 `/media/<file>`，**DB 行里只存这个引用**；客户端写库前统一过 `src/lib/api/media.ts` 的 `uploadDataUrlIfNeeded`，渲染统一过 `mediaUrl()`（`/media/` 拼 serverBase，其余原样）。

## 设置同步模型

**默认全同步**（黑名单制）：`useSettingsStore.setSettings` 会把 patch 里除 `DEVICE_ONLY_KEYS`（`serverUrl`/`serverToken`/`topInsetAdjustmentPx`）外的所有键写入服务器 kv；启动时 `hydrateSettingsFromServer()` 拉回全部 kv 覆盖本地。zustand persist 的 localStorage 只是本地缓存。新增设置键时不用管同步——自动生效，除非它真的是设备相关（那就加进 DEVICE_ONLY_KEYS）。

## 提示词系统（两层，旧三层快照已删除）

- `prompt_presets` 表：`出厂默认`（is_factory，只读，hydrate 时从代码播种）+ 用户命名预设（重名创建会 409）。出厂行刷新走 `PUT /presets/factory`（唯一可写出厂行的端点），客户端 `ensureServerPresets` 按 kv `factoryPresetHash` 门控——模板改动时自动 upsert。
- `Contact.presetName` **按名动态引用**：构建提示词时 `resolveContactPromptModules(contact, settings)` 现查预设内容。原地保存预设 → 所有引用者下一轮生效；另存为新名 → 老引用不动。
- 老数据的 `promptModulesSnapshot` 由**服务器 import 时**转成共享命名预设（`迁移快照`），客户端没有任何快照兜底逻辑。
- `GlobalPromptModulesPage` = 预设管理（原地保存/另存为/删除/应用到联系人/设为新联系人默认 `settings.defaultPresetName`）。

## 非核心功能（休眠机制已落幕）

aiTest 框架已整删（2026-08，见 TODO 第 3 节）；finance/shop/warehouse/career/scopedSaves 已全部迁移回服务器，`DORMANT_MODULES` 为空集合、`src/db/unmigrated.ts` 已删除。保留的唯一前缀机制：`src/lib/aiTestIsolation.ts` 的 `isAiTestId`/`excludeAiTestRows`——过滤旧备份里可能残留的 `ai-test-` 前缀行（18+ 个活跃文件在用，服务器 finance 路由内也有同款前缀常量）。

**已迁移（2026-08）**：
- **finance/wallet/loans**：表 `wallet_accounts`/`wallet_transactions`（幂等键唯一索引）/`loans`；余额变动必须走原子端点 `POST /api/finance/{ensure,transfer,claim-red-packet,claim-daily-salaries,purchase}`（`routes/finance.rs`，客户端封装 `lib/finance.ts`/`lib/inventory.ts`），不要客户端多步读写余额。删联系人级联清钱包/交易/贷款。
- **shop/warehouse**：表 `inventory`（一卡一行）/`shop_purchase_history`（按 productKey 叠加）；购买 = `/api/finance/purchase`（扣款+入卡+历史同事务）。
- **career**：表 `job_listings`/`interviews`（纯 CRUD，无自定义端点）；WorkPage/InterviewPage 已转 api。career 模块重新启用后，ChatPage 金融按钮簇、MePage/DesktopLayout 工资、ContactCardPage 职业/钱包行、chatEngine 经济状况与 AI 金钱气泡全部随之解锁（它们一直在 career 门控后等它）。
- **scopedSaves**：表 `contact_storylines`/`contact_save_snapshots`/`global_save_snapshots`；多表快照操作走原子端点 `POST /api/saves/{restore-contact,restore-global,switch-worldview}`（`routes/saves.rs`，复用 `crud::upsert_row`）。saveLoad 模块已重新启用，**DORMANT_MODULES 已清空**（`features/dormant.ts` 仅剩空集合，整个休眠机制可在确认无回归后拆除）。saveSlots 表无消费方，保持 SKIPPED。

## 测试

- `npx vitest run` — `src/test/setup.ts` 在 `apiFetch` 单点 mock 了一个内存版假服务器（完整语义：过滤/contains/patch/级联/导入导出），`resetFakeServer()` 重置。新测试种数据用 `api.X.put`，不要引用 Dexie。
- `liveMedia.integration.test.ts` 是真实第三方媒体（GIPHY/Atlas）活集成测试，**默认跳过**（生图按次付费 + 需真实 key + 依赖外网）；手动运行方式和时机见文件头注释。
- `npx tsc -b` 必须干净。`npm run lint`（type-aware）**在 Termux 上跑不了**（缺 `@oxlint-tsgolint/android-arm64`），用 `npx oxlint` 代替。
- **sqlx migrate! 是编译期内嵌**：`server/build.rs` 已声明 `rerun-if-changed=migrations`，新增/修改 migration 会自动触发重编（2026-08 之前需要手动 `touch src/db.rs`，曾因此导致"路由新、迁移旧"的 500）。

## 服务器开发

- 表结构约定：真实列只放过滤/排序字段 + `data` JSON 列存完整对象（API 原样返回 data，前端类型直通）；id 数组字段（contactIds/memberContactIds/keywords 等 8 处）镜像到 join 表供 `_contains` 查询。
- 多表原子操作做成批处理端点（`routes/batch.rs`：删联系人/朋友圈/消息的级联），不要让客户端顺序调。
- CRUD 是宏生成的（`crud.rs` + `resources.rs` 声明式注册），加新表 = 一个 migration + 一个 `crud_routes!` + mount + `import_order()` 加映射。
- **媒体不变式（`media_util.rs`）**：DB 任何位置（含快照嵌套 JSON）只许 `/media/<uuid>.<ext>` 引用。文本级对称函数 `extract_data_urls`/`embed_media_files` 与 schema 无关：serve 启动时幂等迁移全表存量 dataUrl、import 边界 extract、export 边界 embed（备份保持自包含 JSON）。GC 只有 sweep（启动时 + `POST /api/media/gc`），引用收集覆盖全表+kv+speech_cache+快照，**删除端点不做即时 unlink**（快照可能持有引用）。mime→扩展名从 subtype 派生（别名表仅 jpeg→jpg 等少数），新文件类型零改动。

## apk 构建

- 见文档, 目前未测试过next分支能否正常通过github action构建(理论可行)
- `next` 分支版本号/versionCode 策略 —— 仅当开发者明确要求bump的时候进行bump, 不进行事实性的与`master`分支区分

## 开发命令

- 前端：`npm run dev` / `npx tsc -b` / `npx oxlint` / `npx vitest run`
- 后端：`cd server && cargo build` / `TALK_TOKEN=xxx ./target/debug/talk-server serve` / `nix build`（在 NixOS 上）
