# 2026-05-14 微信 ret=-2 发送失败加固测试报告

## 变更目的

真实微信长跑时出现 `sendmessage failed: ret=-2 errcode=0`，连续进度消息发送失败后 Bridge 进程退出。本轮修复目标是把这类微信发送临时失败降级为可重试/可记录错误，避免影响 Codex turn、审批和 Bridge 主进程。

## 覆盖内容

- `WeixinAdapter` 将 `ret=-1`、`ret=-2` 视为可重试的 `sendmessage` 临时失败。
- Bridge 普通文本回复发送失败时只记录 warning，不再向上抛出导致 worker 崩溃。
- Bridge 进度消息仍保留独立 warning 日志，但不会因为微信发送失败终止当前任务。
- app-server `agentMessage.phase=commentary` 的分片进度在 `item/completed` 到达时不再重复发送完整文本。
- 新增 mock 集成测试覆盖通道文本发送一直失败时 Bridge 不崩溃。
- 新增微信 API 集成测试覆盖 `ret=-2` 首次失败、重试后成功。
- 新增 app-server 单测覆盖 chunked commentary 不重复转发。

## 执行命令

```bash
npm run build
node --test --test-timeout=5000 dist/tests/unit/app-server-codex-adapter.test.js
node --test --test-timeout=5000 dist/tests/integration/bridge-mock.test.js dist/tests/integration/weixin-adapter-api.test.js
npm test
git diff --check
```

## 结果

- TypeScript build 通过。
- app-server adapter 针对性单测 10 个通过。
- Bridge mock + 微信 API 针对性测试 26 个通过。
- 全量测试 74 个通过。
- `git diff --check` 通过。
