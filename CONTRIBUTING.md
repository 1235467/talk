# 参与贡献

感谢你愿意帮助 Talk 变得更好。提交代码前，请先搜索现有 Issue，避免重复工作；较大的功能建议请先开 Discussion 或 Issue 对齐方向。

## 本地开发

1. Fork 仓库并创建功能分支。
2. 运行 `npm install` 和 `npm run dev`（前端）。
3. 服务器侧：`cd server && cargo build`，然后 `TALK_TOKEN=xxx ./target/debug/talk-server serve`。客户端在设置页填写服务器地址和 token。
4. API Key 通过应用设置页填写（写入服务器 kv）；任何 Key 都不能提交到仓库。
5. 提交前运行：

```bash
npx tsc -b
npx oxlint
npx vitest run
npm run build
```

## 提交约定

- 每个 PR 聚焦一个问题，说明修改动机、验证方式和界面变化。
- UI 改动请附截图或短视频。
- 数据库结构变化 = 新增一个 `server/migrations/NNNN_xxx.sql` + 声明式注册（`crud_routes!` + mount + `import_order()`）；迁移改动会自动触发重编（`build.rs` 已声明 `rerun-if-changed`）。sqlx 离线数据走 `SQLX_OFFLINE`，详见 `server/flake.nix`。
- 写操作后必须 invalidate 对应 TanStack Query 资源名；多表原子操作做成服务器批处理端点，不要让客户端顺序调。
- 独立整页路由必须使用有硬高度边界的滚动布局，避免底部栏被内容撑出视口。
- 聊天请求与回复逻辑应保留在 `src/lib/chatEngine.ts` 等后台引擎中，不要重新绑定到页面组件生命周期。
- 不要提交 `.env`、APK、真实聊天数据或包含 API Key 的备份。

架构与开发约定（请求路径、设置同步、提示词系统、媒体不变式等）请先阅读 [AGENTS.md](AGENTS.md)。
