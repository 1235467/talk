<div align="center">
  <img src="docs/assets/talk-social-preview.png" alt="Talk — 像微信一样自然的 AI 陪伴应用" width="100%" />

  # Talk

  **像微信一样聊天，让 AI 联系人拥有记忆、关系和自己的生活。**

  自托管的 AI companion：创建独一无二的联系人，进行拟人化聊天，并在长期互动中积累记忆、关系、朋友圈和共同经历。
</div>

> [!NOTE]
> 本仓库是 [Entropy2077-axe/talk](https://github.com/Entropy2077-axe/talk) 的服务器化大改 fork。与上游"纯前端、数据存浏览器"的架构不同，本版本以**自建服务器为唯一数据源**，前端（浏览器 / Android）只是客户端。

## 架构

```
浏览器 / Android(Capacitor 壳)  ──→  VPS: talk-server (Rust axum + sqlx + SQLite)
                                      ├── talk.db   ← 全部数据，备份 = 拷文件
                                      └── media/    ← 图片/语音文件
```

- 数据只有一份，没有多端同步问题；换设备只需重新填写服务器地址和 token。
- API Key（DeepSeek、Tavily、Pexels 等）保存在服务器 kv 中，任何设备在设置页修改即时全局生效；设备端唯一的秘密是 server token。
- 第三方请求（AI 聊天、联网搜索、配图、生图、TTS）经服务器代理转发，客户端不直接持有第三方 Key。
- 图片、语音等媒体存为服务器文件，数据库只存 `/media/<file>` 引用；导出备份时自动回嵌为自包含 JSON。

## 它不只是一个聊天框

- **一次创建，长期相处**：通过问卷生成名字、人设、头像和生活习惯；确认后不随意重写人格。
- **有记忆，也有边界**：聊天会沉淀成事实记忆与相处方式，关系变化会影响后续语气和行为。
- **朋友圈真的会运转**：AI 联系人之间存在关系链，会主动发动态、互相点赞、评论和回复。
- **更像真实消息**：分句气泡、输入延迟、未读提醒、表情包、礼物、委托和后台回复。
- **群聊不是轮流念台词**：一次生成多人互动，依据角色关系和当前语境选择发言者。

## 界面预览

<p align="center">
  <img src="docs/assets/screenshots/chat.png" alt="与 AI 联系人聊天" width="30%" />
  <img src="docs/assets/screenshots/moments.png" alt="AI 朋友圈" width="30%" />
  <img src="docs/assets/screenshots/contacts.png" alt="联系人与关系" width="30%" />
</p>
<p align="center">
  <img src="docs/assets/screenshots/group-chat.png" alt="多人设群聊" width="30%" />
  <img src="docs/assets/screenshots/contact-create.png" alt="创建独特联系人" width="30%" />
  <img src="docs/assets/screenshots/modules.png" alt="可选小游戏模块" width="30%" />
</p>

## 部署

### 服务器

需要 Rust 工具链（或 Nix）。服务器是单二进制，启动时自动执行数据库迁移：

```bash
cd server
cargo build --release
TALK_TOKEN=your-secret-token ./target/release/talk-server serve
```

- 鉴权为单用户 bearer token（`TALK_TOKEN`）。
- 数据目录默认在运行目录下（`talk.db` + `media/`），备份 = 拷贝这些文件。
- NixOS 部署可用 `server/flake.nix`（Crane + SQLX_OFFLINE）；反向代理参考 `server/deploy/nginx.conf.template`。
- 其他子命令：`db migrate` / `import <backup.json>` / `stats`。

### 客户端

```bash
npm install
npm run dev        # 浏览器开发
npm run build      # 生产构建（可直接静态托管）
npm run release:apk  # 生成 Android APK（Capacitor）
```

首次打开后在"我 → 设置"中填写服务器地址（`serverUrl`）和 token，随后在设置页填写 DeepSeek 等 API Key（写入服务器 kv，全局生效）。

## 功能状态

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 1:1 聊天、长期记忆与关系 | ✅ 可用 | 支持后台回复、表情包、礼物和委托消息 |
| 联系人问卷与人设生成 | ✅ 可用 | 人设一次确认，避免相处过程中随意漂移 |
| AI 朋友圈与关系链 | ✅ 可用 | 动态、点赞、评论、跟评与可选配图 |
| 多人设群聊 | ✅ 可用 | 根据人物关系与语境选择发言人 |
| 商城、仓库、职业、钱包 | ✅ 可用 | 已迁移至服务器，原子端点保证余额一致 |
| 存档（联系人/全局/世界观） | ✅ 可用 | 多表快照，服务器端原子恢复 |
| 自主消息与生活模拟 | 🧪 实验性 | 默认关闭，开启后会额外消耗 API |
| iOS 原生安装包 | 📌 计划中 | 目前可使用移动浏览器访问网页版 |

## 隐私与费用

- 没有账号系统；全部业务数据保存在你自己部署的服务器上（SQLite 单文件）。
- DeepSeek、Tavily、Pexels 等请求经服务器代理发送到各自服务；费用和数据政策以对应平台为准。
- 任何持有 server token 的设备都能读写全部数据和 API Key，请妥善保管 token 并使用 HTTPS。
- 导出的备份可能包含 API Key 与聊天内容，不要公开上传或发送给他人。

## 本地开发

```bash
npx tsc -b               # 类型检查
npx oxlint               # 静态检查
npx vitest run           # 单元测试（内存假服务器）
npm run build            # 生产构建
npm run test:e2e         # Playwright 回归
```

技术栈：React 19、TypeScript、Vite、Tailwind CSS v4、Zustand、TanStack Query、Capacitor；服务器为 Rust axum + sqlx + SQLite。架构细节与开发约定见 [AGENTS.md](AGENTS.md)。

## License

[MIT](LICENSE) © 2026 Entropy2077-axe（上游作者）
