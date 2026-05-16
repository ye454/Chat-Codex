# 用户固定状态目录与上传目录测试报告

## 变更范围

- 默认 Bridge 状态目录从启动目录下 `state/bridge/` 改为 `~/.chat-codex/state/bridge/`。
- 新增 `CHAT_CODEX_STATE_DIR` 覆盖能力；相对路径按启动时 `process.cwd()` 解析。
- 默认入站媒体上传目录从启动目录下 `.chat-codex-uploads/` 改为 `~/.chat-codex/uploads/`。
- 保留 `CHAT_CODEX_UPLOAD_DIR` 覆盖能力；相对路径按启动时 `process.cwd()` 解析。
- 更新本地状态、入站媒体、飞书凭证、TUI/CLI 和运行锁相关文档。

## 覆盖测试

新增/调整测试：

- `default state root uses fixed user directory`
- `FileStateStore and ChannelConfigStore support CHAT_CODEX_STATE_DIR override`
- `CHAT_CODEX_STATE_DIR relative override resolves from startup cwd`
- `resolveInboundMediaUploadRoot defaults to user upload directory`
- `resolveInboundMediaUploadRoot supports env override`

## 执行结果

```text
npm run build
passed

node --test dist/tests/unit/file-state-store.test.js dist/tests/unit/inbound-media-store.test.js dist/tests/unit/channel-actions.test.js dist/tests/unit/launcher-actions.test.js
19 tests passed

npm test
242 tests passed
```

## 结论

通过 npm/global 方式从任意目录启动时，账号配置、飞书本机凭证、route/session 绑定和入站上传文件默认都会落到当前用户固定目录，不再因为启动目录变化而丢失配置。旧版目录可以手动迁移到 `~/.chat-codex/state/`，也可以临时用 `CHAT_CODEX_STATE_DIR` 指向旧目录。
