# 飞书私聊适配测试报告

日期：2026-05-16

## 测试范围

- 新增飞书私聊 `ChannelAdapter`。
- 飞书 `im.message.receive_v1` 私聊文本事件到 `ChannelMessage` 的转换。
- 飞书 WebSocket 启动、状态摘要、message_id 去重、过期消息过滤。
- 飞书文本出站：优先 `im.message.reply`，失败后 fallback 到 `im.message.create`。
- 飞书默认使用 Bridge 默认投递策略：发送 task-start、progress，允许 `/progress`。
- CLI 入口：`feishu status`、`feishu codex` 和 package scripts。
- 本机密钥文件只放在 `secrets/`，测试报告不记录真实 `FEISHU_APP_SECRET`。

## 自动化测试

### 单元测试

命令：

```bash
npm run test:unit
```

结果：

```text
96 passed, 0 failed
```

覆盖：

- `parseFeishuTextContent` 解析飞书 text JSON。
- `feishuEventToChannelMessage` 映射私聊文本，拒绝群聊、非文本、bot/self echo 和过期消息。
- `FeishuAdapter` 缺少 credentials 时返回 `login_required`。
- `FeishuAdapter` capabilities 只声明第一阶段已实现能力：文本、私聊、Token 登录。
- `FeishuAdapter` 使用默认 delivery policy。
- `sendText()` 优先 reply，reply 失败后按 `chat_id` create。
- CLI help 和 package scripts 暴露飞书入口。

### 集成测试

命令：

```bash
npm run test:integration
```

结果：

```text
66 passed, 0 failed
```

覆盖：

- fake Feishu WebSocket 注入私聊消息后，Bridge 复用通用 `/help`、`/status`。
- 飞书默认投递 `Codex 正在处理这条消息。` task-start。
- 飞书默认投递 `Codex 进度:` reasoning progress。
- `/progress silent` 后同一飞书 route 不再投递 progress，但仍发送最终回复。

### 全量测试

命令：

```bash
npm test
```

结果：

```text
162 passed, 0 failed
```

## 真实配置检查

命令：

```bash
npm run cli:feishu:status
```

环境变量来源：本机 `secrets/feishu.local.md` 中的 `FEISHU_*` 变量行。

结果：

- 飞书状态输出为中文。
- App Secret 只显示“已配置”，未打印真实值。
- App ID 已省略显示。
- 已通过 SDK probe 获取机器人名称和 bot open_id。
- 状态为“已连接”，当前阶段为“配置检查通过”。

### 真实启动冒烟

命令：

```bash
npm run cli:feishu:codex -- --no-interactive
```

结果：

- 已通过真实配置检查。
- Codex CLI 检查通过。
- Bridge 已启动，channels=`feishu`。
- 飞书通道进入 WebSocket 启动流程，无同步启动错误。
- 8 秒后发送 SIGTERM 停止进程。

说明：

- 本次已完成真实凭证的配置 probe。
- 真实私聊收发需要飞书开放平台侧完成事件订阅，并由用户在飞书私聊中发送消息触发；自动化测试已用 fake WebSocket 覆盖同等入站/出站协议路径。

## 格式检查

命令：

```bash
git diff --check
```

结果：通过。
