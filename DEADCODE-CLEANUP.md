# 前端死代码清理报告（2026-08-11，对等基线 0.1.51）

由 039f4a6（SettingsPage 隐藏区块清理）扩展到全前端的死代码审计。**行号基于提交 b087aa1**。

## 审计方法与分支关系

- `tsc -b`（noUnusedLocals/Parameters）与 `npx oxlint` 本已全绿 → 剩下的都是静态检查**不可见**的类别：恒假条件渲染、被 `void` 吊命的组件、零引用导出、死 props/类型。
- 分支关系：`next` 领先 `origin/master`（0.1.51）33 个提交，master 是直接祖先 → **对等基线 = origin/master**。
- 每个删除项均满足：next 内零引用（含测试）+ 删除不改变任何运行时行为。
- 排除范围（刻意保留）：休眠模块文件（shop/warehouse/inventory/finance/wallet/loans/career/scopedSaves/aiTest，含 InterviewPage/interview.ts）。

## 历史考证（三个疑点的定论）

### 1. 女娲模式没有丢
- 活的入口：ContactAddPage:569-572「帮我找人 / 精细创建（女娲模式）」切换，与 master **逐字一致**；体验模式页灰字只是宣传文案（master 相同）。master→next 该文件 diff 仅 Dexie→API + 预设下拉。
- 死区块（772/774/776）是 **v0.1.30 之前**旧版"全自由填写女娲"的尸体：f5e03d1 引入 `draftMode = isNuwaMode` 别名使其恒不可达，**master 0.1.51 中同样是死的**（master:765/767/769）。
- 死区块字段在活的「角色设定」区（867-884）都有一模一样的活编辑器 → 772/774 纯重复。唯一无替代能力：776 的"多特质+好感区间规则"编辑器（0.1.30 前已砍，不在基线内）；但 `customTraits` state 接线活着（加载已存人设→`effectiveNuwaTraits`→创建生效：92/162/323/332/468/509），删的只是手编 UI。

### 2. 联系人页看到的日程表 = SchedulePlanner（活的）
SchedulePlanner（ContactCardPage:689 渲染）与 ScheduleWeekTimeline 用同一套 `schedule-week-*` CSS、同样的周时间轴/图例/翻周，且功能更强（点事件编辑、点空白新建、AI 优化）。**ScheduleWeekTimeline 在 v0.1.50（4f388b5）出生即死**（`+function` 与 `+void` 同提交出现），是从未渲染的只读原型；v0.1.50 同时从 JSX 删掉的是更老的"默认任务"表格。

### 3. getEnabled* 在 0.1.51 里同样是死的
真实有效的实现是 App.tsx:182-195 内联 `moduleRoutes` 与 DiscoverPage:28-42 内联 `moduleEntries`（遍历 `ALL_MODULES`+模块门控，**休眠模块重新启用时路由/入口自动复活**）。唯一更早丢失的是 linkApps 提示词注入（死于 9817018，0.1.51 之前）——恢复路径已记入 TODO 迁移段。

### master 交叉验证的三种情形
| 情形 | 项 | 结论 |
|---|---|---|
| master 里同样死 | 18/20 个 lib 导出、女娲死区块、ScheduleWeekTimeline、moodEnabled、getEnabled*、Avatar props、PersonalityTrait | 删除 = 与 0.1.51 一致 |
| master 活着、next 被服务器化取代 | `cascadeDeleteContactSocialData`、`removeContactFromAllGroups`（由 `api.batch.deleteContact` 级联取代） | 服务器化残留 |
| 0.1.51 之前就死 | 女娲死区块（v0.1.30）、linkApps 注入（9817018） | 不在基线内，不恢复 |

## 执行清单（精确边界）

1. **ContactAddPage.tsx**：删 772/774/776 三个物理行（恒假区块）+ 535-545 `addCustomTrait`/`updateCustomTrait`/`moveCustomTrait`。**保留**：778 行重叠警告（`hasOverlappingCustomTraitRules` 活着）、import 行 23、`customTraits` 及全部接线、`careerEnabled` 相关（等 career 迁移）。
2. **ContactCardPage.tsx**：删 69-128 `ScheduleWeekTimeline`、166 行 `void`、41/43/49/53/61/67 六个 helper/类型。import 行 19 删 `scheduleOccurrencesForDate`（保留同行三个活函数）；行 27 删 `ScheduleBlock`/`ScheduleOverride` 类型；行 39 删 `ChevronLeft`/`ChevronRight`，**保留 `Phone`/`PhoneOff`**（592 行活）。181 行 `moodEnabled = true` 改直接渲染。职业/钱包残留保留。
3. **features/index.ts**：删 `getEnabledRoutes`/`getEnabledDiscoverEntries`/`getEnabledLinkApps`/`MODULE_LINK_APP_OWNERS`。保留 `types.ts` 的 `linkApps` 字段与 shop/career 声明（恢复路径）。
4. **lib 零引用导出 20 个**：prompt.ts `AVAILABLE_LINK_APPS`/`buildWorldviewDraftPrompt`/`parseWorldviewDraft`/`WorldviewDraftResult`；relationship.ts `warmthPrompt`/`containsUpgradeLanguage`；moments.ts `cascadeDeleteContactSocialData`；groupChat.ts `removeContactFromAllGroups`/`pickSpeakers`（+13 行注释）；contactRelations.ts `canReactToMoments`；contactStatus.ts `buildGroupStatusLine`；contactGenerationTasks.ts `cancelContactGenerationTask`；locations.ts `locationCounts`/`upgradeLocationMap`；memory.ts `rememberInitialContactRelation`；photoSearch.ts `requestAnimeImageLegacy`；proactiveChat.ts `AUTONOMOUS_TICK_INTERVAL_MS`；schedule.ts `describeWeeklySchedule`；speechSynthesis.ts `speechCacheStats`；worldbook.ts `foundationalWorldviewText`。连带 reword types/index.ts:901、:936 两处指向被删符号的注释（键本身保留）。
5. **Avatar.tsx**：删 `name`（声明未使用）、`src`（无调用方传值）两个死 prop。
6. **types/index.ts**：删 `PersonalityTrait`（:231，全仓仅定义行；注意与活着的 `CustomPersonalityTrait` 区分）。

## 不删清单（登记在案）

- **活跃文件里的休眠残留**（等 TODO 休眠迁移处理，含 5 处已知假 bug）：ChatPage 金融簇（50-52/180/199-200/509-518/596/926-934/1092-1098）、MePage 工资/余额查询（每次挂载发起注定失败的 query）、ContactAdminPage 钱包 JSON 区（saveAll 每次保存误报错误，168-171）、SettingsPage 管理员余额区（326，显示恒 0 且设定必抛）、DesktopLayout 工资簇、App.tsx `ensureWallets`（启动未捕获 rejection）、backup.ts `ensureWalletsAfterRestore`（恢复备份末步必抛）、chatEngine.ts:768 职业门控。
- **迁移遗留**：stickerApiUrl 等 5 个 legacy 设置键、`globalSystemPrompt`、`worldview`、`promptPresets`（deprecated）、`api.savedWorldviews`、`/knowledge-base` 别名路由——迁移还要跑，全保留。
- **灰色地带**：16 个仅测试引用的导出（arbitrateActionCommittee 等）、resources.ts 宏生成的未用 CRUD 方法面——保留。
- `AdminLogRecord`（归 TODO「删除不迁移」aiTest 整删）、InterviewPage/interview.ts（归休眠 career）。

## 验证

每步后 `npx tsc -b`；全部完成后 `npx oxlint` + `npx vitest run` 三步全绿收工。
