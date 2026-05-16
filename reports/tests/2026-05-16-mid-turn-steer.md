# 2026-05-16 Mid-turn Steer 测试报告

## 背景

Codex CLI 在 turn 执行中允许用户继续输入普通文本，并在下一次工具调用或模型继续推理时投递给当前任务。Bridge 需要把这个能力抽象到中间层协议里，避免只适配微信，同时保留 route/session 隔离。

## 变更

- Bridge 新增 route 级 steer 缓冲：
  - 普通文本在当前 route 有活跃 Codex turn 且 adapter 支持 `steer()` 时，优先投递到当前任务。
  - slash 命令不进入 steer，仍由 Bridge 本地处理；会改变执行语义的命令继续受 route busy guard 阻断。
  - 同一路由连续补充消息按顺序批量合并投递。
  - steer 失败、adapter 不支持或活跃 turn 已结束时，回落到原 prompt 队列。
  - `/status` 显示待投递补充消息数量。
  - `/stop` 会清空尚未提交的补充消息缓冲。
- `AppServerCodexAdapter` 实现 `turn/steer` JSON-RPC：
  - 使用当前 session 的 `currentTurnId` 作为 `expectedTurnId`。
  - 无活跃 turn 时明确报错，由 Bridge fallback 到队列。

## 验证

已执行：

```bash
npm run build
node --test dist/tests/unit/app-server-codex-adapter.test.js
node --test dist/tests/integration/bridge-mock.test.js
npm test
```

结果：

- `npm run build` 通过。
- `app-server-codex-adapter` 单测通过：20 tests passed。
- `bridge-mock` 集成测试通过：61 tests passed。
- `npm test` 全量通过：202 tests passed。

新增/覆盖的关键用例：

- `AppServerCodexAdapter sends turn steer to the active app-server turn`
- `AppServerCodexAdapter rejects steer without an active turn`
- `Bridge steers ordinary text into the active route turn`
- `Bridge batches consecutive route steers in order`
- `Bridge falls back to the route queue when steer is rejected`
- `Bridge keeps commands out of mid-turn steer while a route is busy`
- `Bridge reports and clears pending route steer messages with /stop`
- `Bridge scopes mid-turn steer to the originating route`
