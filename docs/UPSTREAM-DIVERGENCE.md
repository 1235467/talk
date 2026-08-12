# 与上游（Entropy2077-axe/talk master 线）的决策分歧

本 fork 与上游同出 0.1.51。上游 ca4b559 之后的功能（工具调用管线、布局统一等）**只作规格参考，本地按自己的架构与惯例对等功能重写，不拷贝实现**。本文档记录每一处有意识的决策分歧及理由。

## 1. 存档机制：暂时不合并上游 worldSnapshots

- 上游：`worldSnapshots.ts` 世界中心快照（Dexie 表级打包，`WORLD_STORY_TABLES` 约 20 张表整体进出）。
- 本地：`scopedSaves`（`contact_storylines`/`contact_save_snapshots`/`global_save_snapshots` 表 + `/api/saves/{restore-contact,restore-global,switch-worldview}` 多表原子端点）。
- 理由：本地数据源在服务器（单副本），多表原子操作由服务器事务保证；上游方案是 IndexedDB 架构下的表级打包，两者模型不可通约。

## 2. 级联管线：保留为非 agent 模式的活路径

- 上游 ca4b559 用工具调用替换三模型级联（主模型 → insertToolCallsIntoRawTurn → auditAndRepairRawTurn）后，`responseQuality.ts` 变成零引用死文件仍留在仓库——决策失误。
- 本地：级联**保留为 agent 模式关闭时的正式管线**。引擎按 `generationByProvider[provider].agentMode`（默认开）二选一：开 = 工具调用管线；关 = 级联。部分 API 不支持或极差地支持工具调用，也有用户就是想关——不做自动探测，用户自己判定。

## 3. mood 文本化：方向跟随，措辞不抄

- 上游：持久化 mood 从 emoji 改为"简短中文文字"，遗留 emoji 读时映射。
- 本地：同样改文本心情 + 读时迁移，但提示词写"**自然的**中文词语（如开心、担心、期待、平静、不高兴）" 而非简短的词语

## 4. 生成参数：按 provider 绑定，不挂预设

- 上游：sampling（temperature/topP/topK）挂在单层预设 `activePromptPreset` 上。
- 本地：`AppSettings.generationByProvider`（仿既有 `baseUrls` 的 per-provider 镜像模式）——maxOutputTokens / reasoningEffort / streamEnabled / temperature / topP / topK 按 provider 存。理由：能力差异是 API 级的（K3 需要 effort (默认 max + 不支持关闭思考) + 流式 + 大 max token，DeepSeek 支持关闭思考），切 provider 不应互相覆盖；本地预设是两层按名动态引用模型，没有 activePromptPreset 概念。

## 5. 回复超时：可配置，默认 5 分钟

- 上游：`chatResponseTimeoutMs` 可配置，默认 60s。
- 本地：同名可配置（0=不超时，上限 10 分钟），默认 **300s**——推理模型长考场景下 60s 会误杀正常回合

## 6. 去模型名特判：isK3Model 正则删除

- 本地旧债：`isK3Model`（模型名含 "k3" 正则）硬编码了强制 `reasoning_effort='high'`、删 temperature、删 max_tokens 上限、仅 K3 开流式。
- 现在：全部显式配置化。K3 的使用路径 = 该 provider 的 profile 里 effort 选 high/max + 开流式 + max token 用默认 8096。**模型名正则不保留**。

## 7. 流式：独立的 per-provider 开关

- 不绑定模型名（上游/本地旧债），也不绑定推理开关——**有些 API 只支持流式响应**，是否流式是传输层选择，由用户在对应 provider 的 profile 里勾选。`streamEnabled` 默认关（保持现状行为）。
- 无防御性降级：配了什么就发什么（tools × stream 等不做客户端的支持判定），确认API 支持流式输出/工具调用是 API 使用者的责任。

## 8. 推理 effort：auto 下拉取代开关

- `reasoningEffort: 'auto' | 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`，默认 auto。
- **auto = 完全不传 thinking/effort 字段**（provider 用自家默认——思考型模型默认即开），不需要单独的"启用推理"勾选。
- **off = 显式禁用**（reasoning_effort 系发 `'none'`、deepseek 系 `thinking:{type:'disabled'}`、enable_thinking 系 `false`、anthropic 不传）——auto 对默认思考的模型等于开，所以必须有显式禁用档。强制思考的模型（如 K3）选 off 会被 API 拒绝，符合无防御性特判原则。
- 其余档位透传 effort；布尔系 adapter 任何非 auto/off 值 = 开。xhigh/max 是部分模型特有档位，透传不校验。

## 9. 温度单一来源：profile，默认 1.0

- 旧默认 1.1 改为 **1.0**：绝大多数模型 1 本身就是默认值，且 K3 这类锁温度的服务只接受显式 1.0——默认 1 让锁温模型零配置可用，模型名特判的最后理由消失。
- **调用点不再传温度**（`ChatCompletionOptions.temperature` 已删除）：旧代码里聊天 0.9、重生成 0.55、转换 0 等散落的魔法数字与 maxTokens/thinking 同属一类隐藏调参，全部清除。温度 = 当前 provider profile 的 `samplingTemperature`（留空则 1.0，clamp 到 provider 合法范围）。

## 10. 工具调用管线：方向跟随，实现重写

- 方向一致：AI 回合产出从"自由文本嵌 JSON 协议"改为 schema 约束的 tool calls（私聊 10 工具 / 群聊 5 工具），不支持 tools 的 provider 走 utility 模型 plan 转换兜底。
- 不抄的上游残留：`parseGroupToolCalls` 返回类型里的 `planCandidates: []`（诡异的空数组占位）；工具描述里 mood 的"简短"措辞（见 §3）。
- 本地架构优势：`/api/ai-proxy` 的 payload 是不透明 JSON 原样转发，tools/tool_calls 自动透传，**服务器零改动**。

## 11. 明确跳过的上游项

- **B 回复超时**：以本地版吸收（见 §5）。
- **C 地点群成员不再按世界观过滤 / E 联系人会话 ensure**：本轮不做。
- **F Android 备份导出修复**：上游依赖的 `BackupDirectory` 原生插件实现不在其仓库内（android/ 被 gitignore），无法参考；且本地壳将迁 Tauri 2（或 Flutter），Capacitor 插件投资无意义。
- **G UI 布局统一**：只落壳无关的规范文档（`docs/DESIGN_SYSTEM.md`），CSS 骨架类与页面套用**暂缓**——壳未定（Tauri 2 流畅度待验证，Flutter 为备选），若换 Flutter，web 样式投资全部作废。

## 12. 提示词模板的渗透通道

模板文案改动（如 §3 的 mood 措辞）只改代码里的默认模板；服务器上的出厂预设由 `ensureServerPresets` 按 kv `factoryPresetHash` 门控自动刷新，用户命名预设不受影响（按名引用，原地保存才变）。
