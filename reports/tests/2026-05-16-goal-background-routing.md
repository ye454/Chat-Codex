# 测试报告：Goal 后台续跑路由修复

## 测试目标

验证 `/goal <目标>` 设置后由 Codex app-server 自动触发的 Goal 续跑 turn 能进入中间件通用事件链路，并按原会话渠道完成 progress、审批、错误和最终结果路由。

重点覆盖：

1. AppServerCodexAdapter 能把非 `run()` 主动启动的 Goal 自动续跑事件转成 background events。
2. Bridge 能按 `sessionId -> routeKey -> target` 找回原通讯渠道。
3. 微信渠道仍不投递 progress，但会把被抑制的 progress 写入本地 transcript。
4. 微信渠道仍投递最终结果。
5. Goal 后台 turn 运行期间，同 route 后续普通消息会进入队列，避免同一会话并发执行。
6. `/status` 对 Goal 显示状态、目标、token 用量、耗时和更新时间。

## 测试环境

- 日期：2026-05-16 00:01:52 CST
- 分支/提交：`main` / `f4ce012`
- Node.js 版本：`v24.13.1`
- 操作系统：Darwin xiaohuangdeMini 25.3.0 arm64
- Codex 版本：未调用真实 Codex；使用 fake app-server 与 mock Codex adapter
- 渠道：mock / weixin-like mock policy

## 执行命令

```bash
npm run build
node --test dist/tests/unit/app-server-codex-adapter.test.js
node --test dist/tests/integration/bridge-mock.test.js
git diff --check
npm test
```

## 测试步骤

1. 新增 Codex background event 订阅接口，并在 app-server adapter 中模拟 Goal 自动续跑通知。
2. 用 fake app-server 验证 `thread/goal/set` 后的 `turn/started`、progress、final 和 `turn/completed` 会被作为 background events 发出。
3. 用 weixin-like mock channel 验证后台 Goal turn 的最终结果会发回微信目标。
4. 验证微信 progress 不进入渠道发送列表，但进入本地 transcript。
5. 验证后台 Goal turn 未结束时，同 route 普通消息会收到排队提示，后台 turn 完成后再进入 Codex `run()`。
6. 验证 `/status` 中 Goal 行包含状态、目标、tokens、time 和 updated。
7. 跑全量测试和 diff 空白检查。

## 实际结果

- `npm run build`：通过。
- `node --test dist/tests/unit/app-server-codex-adapter.test.js`：18 passed。
- `node --test dist/tests/integration/bridge-mock.test.js`：45 passed。
- `git diff --check`：通过。
- `npm test`：139 passed，0 failed。

关键新增覆盖：

- `AppServerCodexAdapter emits goal auto-continuation as background events`
- `Bridge routes background goal turn final to weixin and logs progress locally`
- `Bridge queues route messages while background goal turn is running`
- `Bridge manages experimental goal commands for the current session` 中补充 `/status` Goal 进度字段断言

## 结论

通过。

本次修复已覆盖 mock/fake app-server 等价流程：Goal 自动续跑不会再被 adapter 丢弃，Bridge 能把最终结果投递回原渠道，并把微信被抑制的 progress 写入终端 transcript。

## 遗留问题

- 真实微信通道需要用户登录后补测：发送 `/goal <目标>`，确认终端能看到“本地进度（未投递）”，微信能收到最终结果。
- 当前未做 progress 持久化，符合现阶段轻量设计。
