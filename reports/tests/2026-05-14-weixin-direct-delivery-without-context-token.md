# 测试报告：微信直接投递默认不带 context_token

## 测试目标

验证 WeixinAdapter 改为直接投递模型后，文本、图片和文件 `sendmessage` 默认不携带入站消息的 `context_token`，同时保留入站解析、typing 使用和旧 fallback 兼容逻辑。

## 背景

真实微信长任务中，Codex progress/final 等出站消息复用旧 `context_token` 时可能触发 `sendmessage failed: ret=-2 errcode=0`。对照 `openclaw-weixin` 的 cron 主动投递模型后，判断 `context_token` 不是发送授权凭证；真正投递依赖的是 `bot_token + to_user_id + sendmessage`。

因此本轮策略调整为：

- 接收时仍保留 `context_token`，方便观察、调试和回退。
- 文本、图片和文件发送默认不携带 `context_token`。
- typing 暂时保留使用 `context_token` 获取 `typing_ticket`。
- 原有带 token 时 `ret=-2` 后去 token fallback 保留为兼容路径。

## 测试环境

- 日期：2026-05-14
- Node.js：v24.14.0
- 分支：main
- 渠道：mock / weixin fake fetch / 用户真实微信初步验证

## 执行命令

```bash
npm run build
node --test --test-timeout=5000 dist/tests/integration/weixin-adapter-api.test.js dist/tests/unit/weixin-message-mapping.test.js
npm test
git diff --check
```

## 覆盖点

- `WeixinAdapter.sendText()` 即使 target 带 `contextToken`，`sendmessage` body 也不包含 `msg.context_token`。
- `WeixinAdapter.sendMedia()` 发送图片 caption 和图片 item 时，两个 `sendmessage` body 都不包含 `msg.context_token`。
- 入站消息映射仍会把原始 `context_token` 保留到 `ChannelTarget.context.contextToken`。
- typing 仍会把 `context_token` 带给 `getconfig` 获取 `typing_ticket`。
- `ret=-2` 临时失败重试逻辑仍通过测试。

## 结果

- TypeScript build 通过。
- 针对性微信 adapter + 入站映射测试 15 个通过。
- 全量测试 83 个通过。
- `git diff --check` 通过。
- 用户真实微信侧初步验证：常驻进程运行中，改为直接投递后暂未观察到明显问题。

## 结论

通过。微信 `sendmessage` 现已默认走无 `context_token` 的直接投递模型，降低长任务复用旧上下文导致 `ret=-2` 的概率。
