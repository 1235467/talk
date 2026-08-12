# Talk vX.Y.Z

## 本次更新

- 亮点一
- 亮点二
- 修复项

## 下载与安装

从下方 Assets 下载 `app-debug.apk`。当前 APK 使用 github action 中的keystore 签名，签名固定可正常覆盖更新.

本应用需要连接自建的 talk-server（部署方式见 README）。首次打开后请在"我 → 设置"中填写服务器地址和 token；业务数据保存在服务器上，APK 升级或重装不影响数据。

## API Key 与隐私

此 APK 不内置 DeepSeek、Tavily 或 Pexels API Key。请在应用设置页填写自己的 Key；Key 保存在服务器 kv 中，任何设备修改即时全局生效。

请不要公开分享包含 API Key 或私人聊天的备份文件，并妥善保管 server token（持有 token 即可读写全部数据）。

## 文件校验

```text
SHA-256: <发布前填写>
```
