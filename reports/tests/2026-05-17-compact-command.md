# `/compact` 上下文压缩命令验证

## 背景

Chat-Codex 之前没有适配 Codex CLI 原生 `/compact` 命令。从微信或飞书聊天发送 `/compact` 会被 Bridge 当成未知命令，无法触发当前 session 的上下文压缩。

## 实现范围

- 新增 `/compact` 聊天命令，作用于当前 route 当前绑定的 Codex session。
- `/compact` 只创建确认态，`/compact confirm` 才实际执行压缩。
- `/cancel` 可取消待确认的 compact。
- compact 执行中发送开始通知、完成通知或失败通知。
- compact 执行中同 route 只允许 `/status`、`/help`、`/whoami`、`/debug`。
- compact 执行中拒绝 `/stop`、其它修改类命令、普通文本、图片和文件入站。
- compact 只阻断当前 route，不影响其它 route。
- `/compact` 确认提示展示压缩前当前上下文 token。
- compact 完成后重新读取 status，展示压缩后当前上下文 token；无数据时明确提示暂无 token 数据。
- `CodexAdapter` 增加 `compactSession()` 可选能力。
- `MockCodexAdapter` 支持 compact 测试。
- `AppServerCodexAdapter` 调用官方 `thread/compact/start`，并等待 `contextCompaction`、`thread/compacted` 或 `turn/completed` 通知确认完成。
- `/help`、`/status`、README / README.en 增加 `/compact` 说明。

## 已执行验证

```bash
npm run build
node --test dist/tests/unit/bridge-formatters.test.js dist/tests/unit/bridge-command-router.test.js dist/tests/unit/command-parser.test.js dist/tests/unit/app-server-codex-adapter.test.js
node --test dist/tests/integration/bridge-mock.test.js --test-name-pattern "compact|help|status"
node --test dist/tests/unit/bridge-formatters.test.js dist/tests/unit/bridge-command-router.test.js dist/tests/unit/command-parser.test.js dist/tests/unit/app-server-codex-adapter.test.js dist/tests/integration/bridge-mock.test.js --test-name-pattern "compact|BridgeCommandRouter|bridge formatters|parseCommand|AppServerCodexAdapter starts and waits for thread compaction"
npm test
git diff --check
```

## 关键验证点

- `/help` 包含 `/compact`。
- `/compact` 生成确认提示，不直接执行。
- `/compact` 确认提示包含“压缩前上下文”。
- `/cancel` 能取消确认态。
- `/compact confirm` 调用 adapter 的 compact 能力。
- 成功后发送“上下文压缩完成”通知。
- 成功通知包含“压缩后上下文”。
- `/status` 能显示“上下文压缩: 等待确认 / 进行中”。
- compact 进行中 `/stop` 被拒绝。
- compact 进行中普通文本被拒绝，不进入 Codex run。
- compact 进行中其它 route 可以继续正常执行。
- app-server fake RPC 验证 `thread/compact/start` 调用和完成通知等待。

## 结果

- 构建通过。
- 定向测试通过。
- 全量 `npm test` 通过，`295 passed, 0 failed`。
- `git diff --check` 通过。
