# talk-server

Talk 应用的后端：唯一数据源。axum + sqlx(SQLite, WAL) + clap 单二进制。

## 形态

```
talk-server serve              # 启动 HTTP 服务（启动时自动跑 sqlx::migrate!()）
talk-server db migrate         # 只应用迁移（预检）
talk-server import backup.json # 导入 web 端 backup.ts 导出的 talk-backup JSON
talk-server stats              # 打印各表行数
```

## 配置（环境变量）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TALK_DATABASE_PATH` | `talk.db` | SQLite 文件路径 |
| `TALK_MEDIA_DIR` | `media` | 图片/语音文件目录 |
| `TALK_ADDRESS_PORT` | `127.0.0.1:3300` | 监听地址（nginx 反代到本机） |
| `TALK_TOKEN` | （空=拒绝一切 API 请求） | 单用户 bearer token |
| `TALK_LOG` | `info,tower_http=info` | tracing 日志级别 |

AI Key 和第三方 provider 配置不走环境变量：都在 kv 表里，任何通过 token 鉴权的设备都能在 设置页查看/修改，改动即时同步到全部设备（`/api/ai-proxy` 每次请求现读 kv）。

## 数据原则

- 数据库就是一个 `.db` 文件。备份 = 拷文件；查看 = `sqlite3 talk.db`。
- 嵌套负载（人设、日程、记忆等）存 JSON 列，serde 校验；核心列（id、外键、时间戳、状态）用真列 + `query_as!` 编译期校验。
- `.sqlx/` 离线缓存提交进 git，构建机不需要数据库（`SQLX_OFFLINE=true`，flake 已设置）。

## Non-features

明确不做的事情：

- 多用户/权限系统（单用户 token 就是全部鉴权）
- 同步协议（数据只有服务器一份，没有需要同步的东西）
- 商城/仓库/委托/金融/职业/AI 测试框架（前端功能模块禁用，数据不迁移）
- Docker 镜像（用 flake 构建，见 `flake.nix`）
- Caddy 集成（反代见 `deploy/nginx.conf.template`，自行接入现有 nginx）
- AI 回复编排（chatEngine 一期留在前端，服务端只做存储和转发）

## 参考实现

- 形态/风格：github.com/matze/wastebin
- SQLite 运维：github.com/tranxuanthang/lrclib
- sqlx 迁移 + 编译期查询工作流：github.com/synctv-org/synctv
