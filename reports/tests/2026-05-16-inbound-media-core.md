# 测试报告：入站图片和文件核心逻辑

## 测试目标

验证入站媒体第一阶段核心能力：

- Bridge 能接收 attachment-only 消息并进入 route 级 pending media。
- 下一条普通文本能合并 pending 图片并投递 Codex。
- 图文同消息能直接投递 Codex。
- busy route 下图文输入优先通过结构化 `turn/steer` 投递，失败时回退当前 route 队列。
- app-server adapter 能把 `localImage` 发送到 `turn/start` 和 `turn/steer`。
- 上传目录 helper 使用启动目录 `.chat-codex-uploads/`，并支持 `CHAT_CODEX_UPLOAD_DIR` 覆盖。

## 测试环境

- 日期：2026-05-16
- 分支/提交：main，本地未提交工作区
- Node.js 版本：v24.14.0
- 操作系统：macOS
- Codex 版本：未调用真实 Codex，使用 fake app-server 和 mock adapter
- 渠道：mock

## 执行命令

```bash
npm run build
node --test dist/tests/unit/app-server-codex-adapter.test.js
node --test dist/tests/unit/inbound-media-store.test.js
node --test dist/tests/integration/bridge-mock.test.js
npm test
git diff --check
```

## 测试步骤

1. 扩展协议和 Codex 输入类型后执行 TypeScript 构建。
2. 用 fake app-server 验证 `localImage` 出现在 `turn/start` 和 `turn/steer` input 中。
3. 用 mock channel 验证图片-only、图片+文本、pending media、busy steer、steer fallback 和 route 隔离。
4. 验证上传目录解析、路径 sanitize、route hash、图片 magic bytes MIME 推断和本地写入。
5. 执行全量测试，确认旧命令、审批、Goal、Plan、/sendfile、微信/飞书现有行为不回退。
6. 执行 `git diff --check` 检查空白问题。

## 实际结果

- `npm run build`：通过。
- `node --test dist/tests/unit/app-server-codex-adapter.test.js`：22 tests passed。
- `node --test dist/tests/unit/inbound-media-store.test.js`：4 tests passed。
- `node --test dist/tests/integration/bridge-mock.test.js`：71 tests passed。
- `npm test`：229 tests passed。
- `git diff --check`：通过。

新增关键测试：

- `Bridge stores image-only messages as pending media without running Codex`
- `Bridge combines pending image-only media with the next ordinary text`
- `Bridge sends same-message text and image directly to Codex`
- `Bridge keeps pending media scoped to the originating route`
- `Bridge steers text plus image into the active route turn`
- `Bridge keeps image-only media pending while the route is busy`
- `Bridge starts a new turn when pending media is described after the busy turn ends`
- `Bridge falls back to route queue with image input when structured steer is rejected`
- `AppServerCodexAdapter sends localImage on turn start`
- `AppServerCodexAdapter sends localImage on turn steer`

## 结论

通过。入站媒体核心链路已在 mock/app-server 层验证完成。

## 遗留问题

- 真实微信 `image_item` / `file_item` 下载保存尚未接入。
- 真实飞书图片/文件事件映射和资源下载尚未接入。
- TUI 上传目录配置不在本轮范围内，后续按设计文档补。
