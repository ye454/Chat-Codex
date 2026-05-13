# 2026-05-14 会话标题、阶段进度与消息队列测试报告

## 测试目标

- 验证历史 Codex 会话列表能读取更友好的标题或首条用户消息。
- 验证 `/sessions all` 与启动会话选择列表使用同一套标题发现逻辑。
- 验证 `codex exec --json` 的 reasoning summary、命令执行等事件能转为微信进度消息。
- 验证同一微信上下文中的普通消息会串行排队，命令消息仍可立即响应。

## 覆盖范围

- `src/codex/codex-cli.ts`
- `src/codex/exec-codex-adapter.ts`
- `src/codex/types.ts`
- `src/cli.ts`
- `src/bridge/bridge.ts`
- `tests/unit/codex-cli.test.ts`
- `tests/unit/exec-codex-adapter.test.ts`
- `tests/integration/bridge-mock.test.ts`

## 自动化测试

命令：

```bash
npm test
```

结果：

```text
tests 36
pass 36
fail 0
cancelled 0
```

新增重点用例：

- `discoverCodexSessions reads friendly titles from Codex sqlite state`
- `parseExecJsonLine maps exec progress items`
- `ExecCodexAdapter lists sqlite titles for discovered sessions`
- `Bridge queues normal prompts for the same route while keeping commands responsive`

## 本机验证

执行构建后的会话发现脚本，确认当前本机历史会话已能显示标题或首条用户消息。例如新的会话列表会展示类似：

```text
019e22b8-28c9-7dd1-af93-ed5b36cac60c hi，我在测试和你的通信 ...
```

## 遗留说明

当前 exec adapter 的阶段性输出受 `codex exec --json` 事件限制，只能发送可见的 reasoning summary、命令/工具/文件变更摘要和最终回复。真正的同 turn steering、插入用户消息、细粒度 delta 和电脑端 Codex UI 实时同屏，仍需要后续 app-server adapter。
