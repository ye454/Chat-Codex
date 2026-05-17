# `/compact` 上下文压缩命令设计

## 背景

Codex CLI 原生支持 `/compact`，用于在长会话后把早期对话压缩成摘要，释放上下文空间，同时保留关键细节。官方行为是用户输入 `/compact` 后，Codex 会要求确认，再执行摘要压缩。

Chat-Codex 当前没有适配该命令。从微信或飞书发送 `/compact` 会被 Bridge 当成未知命令处理。

## 目标

1. 在微信和飞书私聊里支持 `/compact`。
2. 作用域限定为当前 route 当前绑定的 Codex session。
3. 压缩上下文前必须显式确认，避免误操作改写 thread 上下文。
4. 压缩执行期间必须有明确状态提示和完成/失败通知。
5. 压缩执行期间禁止会改变执行语义或 session 绑定的操作，避免上下文压缩和用户命令并发写同一个 thread。
6. Bridge Core 只依赖 `CodexAdapter` 能力，不把 app-server 细节写进命令层。

## 非目标

- 不做跨 route 的全局压缩。
- 不压缩未绑定 session 的 route。
- 不把 `/compact` 当普通 prompt 发给 Codex。
- 不在第一版支持自动按 token 阈值触发压缩。
- 不在第一版支持自定义 compact prompt。
- 不在第一版让用户从聊天侧编辑压缩摘要。

## 用户交互

### 查看和确认

用户发送：

```text
/compact
```

如果当前 route 已绑定 session，Bridge 回复确认提示：

```text
即将压缩当前 Codex session 的历史上下文。

Session: 019e...
压缩前上下文: `164,171 / 258,400 token`（63.5%，剩余 94,229）
说明: 压缩会把较早对话替换为摘要，释放上下文空间。当前绑定和工作目录不变。

发送 /compact confirm 开始压缩。
发送 /cancel 取消本次确认。
```

用户发送：

```text
/compact confirm
```

Bridge 才真正执行压缩。

### 执行中提示

开始执行后，Bridge 立即回复：

```text
已开始压缩当前 Codex session 上下文。完成后会通知你。
```

如果渠道支持 typing，可以在压缩期间显示 typing。

### 完成通知

压缩成功后，Bridge 回复：

```text
上下文压缩完成。

Session: 019e...
摘要已写回 Codex thread，后续消息会基于压缩后的上下文继续。
压缩后上下文: `42,000 / 258,400 token`（16.3%，剩余 216,400）
```

Bridge 执行完成后会再次读取当前 session status。如果 Codex adapter 暂时没有返回上下文 token 数据，回复：

```text
压缩后上下文: 暂无 token 数据。可发送 /status 查看后续状态。
```

如果 Codex adapter 能直接返回 token 或摘要统计，后续可追加 `beforeTokens` / `afterTokens` 等更精确字段；第一版不强依赖这些统计。

### 失败通知

失败时回复：

```text
上下文压缩失败：<原因>

当前 session 绑定未改变。你可以稍后重试，或发送 /status 查看状态。
```

如果当前 CodexAdapter 不支持压缩：

```text
当前 Codex 接入方式不支持 /compact。请升级 Codex 或切换到支持上下文压缩的 app-server 接入。
```

## 命令作用域

`/compact` 只作用当前消息所在 route：

```text
<channelId>:<accountId>:<conversationKind>:<conversationId>
```

它压缩的是当前 route active session 对应的 Codex thread。

不会影响：

- 同一微信账号里的其他聊天 route。
- 同一个飞书机器人的其他私聊 `chat_id`。
- 其他 route 绑定的其他 session。

如果当前 route 没有 active session：

```text
当前聊天还没有绑定 Codex session。请先发送 /new 创建新会话，或发送 /resume 绑定已有会话。
```

## 执行期间的并发规则

上下文压缩是当前 session 的维护型独占操作。它会改写 thread 的历史上下文，因此执行期间必须避免同一个 route/session 上发生其它会改变上下文、绑定、权限、模型或目标状态的操作。

### `/compact confirm` 前

`/compact` 的确认等待不是 Codex 执行状态，只是 Bridge 本地 pending confirmation。

允许：

- `/cancel`：取消本次 compact 确认。
- `/status`：显示有待确认 compact。
- `/help`

如果用户发送普通文本，第一版不自动开始压缩，也不把普通文本当确认。普通文本按当前 route 正常处理，并清除本次 compact 确认，避免误触。

### 压缩执行中允许的命令

执行中只允许只读状态类命令：

- `/status`
- `/help`
- `/whoami`
- `/debug`

`/status` 应显示：

```text
- 上下文压缩: 进行中
- 可用操作: 等待完成后继续；当前不支持中途取消 compact
```

### 压缩执行中禁止的命令

执行中拒绝以下命令：

- `/compact`
- `/compact confirm`
- `/stop`
- `/cancel`
- `/new`
- `/resume`
- `/use`
- `/sessions` 的编号选择
- `/plan`
- `/code`
- `/permission approval`
- `/permission full confirm`
- `/model <...>`
- `/model effort <...>`
- `/model default`
- `/goal <目标>`
- `/goal pause`
- `/goal resume`
- `/goal clear`
- `/sendfile <任务>`
- 普通文本 prompt
- 图片/文件入站投递

统一回复：

```text
当前正在压缩上下文，请等待完成后再操作。
```

### 为什么第一版禁止 `/stop`

`/stop` 当前语义是终止正在运行的 Codex turn。`/compact` 是维护型上下文改写操作，和普通 turn 不完全等价。若在压缩中断时 Codex 已部分写入摘要，Bridge 很难可靠判断 thread 是否处于旧上下文、压缩中间态还是压缩后状态。

第一版为了保证上下文一致性，`/compact` 执行中不支持 `/stop`。后续如果 Codex app-server 提供明确可取消且事务化的 compact API，可以再设计：

```text
/compact cancel
```

而不是复用 `/stop`。

## 状态模型

Bridge 需要在 route 级维护 compact 状态：

```ts
type CompactState =
  | { type: "none" }
  | { type: "confirming"; sessionId: string; requestedAt: string }
  | { type: "running"; sessionId: string; startedAt: string };
```

第一版状态只放内存，不持久化：

- Bridge 重启后不恢复 compact confirmation。
- 如果压缩进行中 Bridge 进程退出，结果以 Codex app-server/thread 实际状态为准；重启后用户通过 `/status` 查看当前 thread。

原因：

- 确认态是短生命周期本地交互，不应落盘。
- 运行态由 Codex adapter/app-server 真正执行，Bridge 落盘也无法可靠恢复中断中的 API 调用。

## CodexAdapter 能力

新增可选能力：

```ts
export interface CodexCompactResult {
  sessionId: string;
  message?: string;
  beforeTokens?: number;
  afterTokens?: number;
}

export interface CodexAdapter {
  compactSession?(sessionId: string): Promise<CodexCompactResult>;
}
```

行为约定：

- 不支持时不实现 `compactSession`。
- 支持时必须等压缩完成后 resolve。
- 失败时 reject，并带可读错误。
- 执行期间 adapter 应把该 session 状态视为 running 或 waiting_input 之外的维护状态；如果现有 `CodexSessionStatus` 没有 compact 类型，可先由 Bridge 维护 compact 状态并在 `/status` 中展示。

### AppServerCodexAdapter

通过 Codex app-server 官方能力实现。已从本地 Codex app-server protocol 和 TUI 调用确认方法名：

```text
thread/compact/start
```

请求参数：

```json
{ "threadId": "<sessionId>" }
```

请求会立即返回 `{}`。压缩进度和完成状态通过同一 `threadId` 上的标准 `turn/*`、`item/*` 通知体现，其中 compact item 类型为 `contextCompaction`；旧协议还可能发送 `thread/compacted` 通知。

如果未来运行环境里的 Codex app-server 不支持该方法，第一版应返回“不支持”，不要用普通 prompt 模拟压缩。

### ExecCodexAdapter

第一版不支持。

原因：

- `codex exec` 是非交互流程，不适合驱动需要确认的 TUI slash command。
- 通过 shell 启动交互式 `codex resume` 再发送 `/compact` 会引入脆弱的 TTY 自动化和确认处理，不符合当前 adapter 稳定性要求。

### MockCodexAdapter

实现测试用 `compactSession()`：

- 记录被 compact 的 sessionId。
- 可配置成功或失败。
- 不实际改写上下文。

## Bridge 命令模块设计

新增：

```text
src/bridge/commands/compact-command.ts
```

职责：

- 解析 `/compact`、`/compact confirm`。
- 创建/清理 route compact confirmation。
- 检查当前 route active session。
- 调用 `codex.compactSession(sessionId)`。
- 发送开始、成功、失败文案。

修改：

```text
src/bridge/command-router.ts
src/bridge/formatters.ts
src/bridge/status-text.ts
src/bridge/bridge.ts
src/codex/types.ts
```

需要扩展：

- `BridgeCommandHandlers.compact(...)`
- command router 增加 `compact` 分支。
- busy guard 把 `/compact` 和 `/compact confirm` 视为 mutation。
- 增加 compact running guard，在普通 prompt 和大部分命令入口前拒绝。
- `/help` 增加 `/compact`。
- `/status` 显示 compact confirming/running。

## Busy Guard 规则调整

当前 `isRouteBusyMutationCommand()` 只判断 route worker、pending approval、background goal 或队列等执行状态下哪些命令要被拒绝。`/compact` 需要两层规则：

1. **已有 route busy 时**：拒绝 `/compact` 和 `/compact confirm`。
2. **compact running 时**：拒绝除 `/status`、`/help`、`/whoami`、`/debug` 外的所有命令和普通输入。

`/compact` 不应进入普通 route queue，也不应被 mid-turn steer。

## 普通消息和媒体处理

compact running 时：

- 普通文本不入队。
- 图片/文件不进入 pending media。
- 同 route 直接回复：

```text
当前正在压缩上下文，请等待完成后再发送消息。
```

其它 route 不受影响。

## 通知和日志

需要记录 transcript/runtime log：

- compact confirmation created
- compact started
- compact completed
- compact failed
- compact command rejected because route/session busy

运行期 TUI 日志应能看到开始和完成事件。

聊天侧至少发送：

1. 开始通知。
2. 完成通知或失败通知。

## README 和帮助文案

README 聊天命令新增：

```text
| `/compact` | 压缩当前 session 的历史上下文，需 `/compact confirm` 确认 |
```

`/help` 新增：

```text
/compact
压缩当前 Codex session 的历史上下文；需要 /compact confirm 确认。
```

## 测试计划

### 单元测试

- `parseCommand` 能解析 `/compact` 和 `/compact confirm`。
- `isRouteBusyMutationCommand("compact", ...)` 返回 true。
- `compact-command`：
  - 未绑定 session 时给出提示。
  - `/compact` 创建确认。
  - `/compact confirm` 调用 adapter。
  - 未确认时不执行。
  - adapter 不支持时给出提示。
  - 成功/失败文案正确。

### Bridge 集成测试

- `/help` 包含 `/compact`。
- `/compact` -> `/compact confirm` 成功流程。
- compact 执行中：
  - `/status` 可用并显示压缩中。
  - `/help` 可用。
  - `/stop` 被拒绝。
  - `/new`、`/resume`、`/permission full confirm`、`/model ...`、`/goal ...` 被拒绝。
  - 普通文本被拒绝，不进入 Codex run。
- compact 只影响当前 route，不阻塞其它 route。

### Adapter 测试

- `MockCodexAdapter.compactSession()` 记录调用。
- `AppServerCodexAdapter` 如果接入真实 compact API，需要 fake RPC 测试方法名、payload、成功/失败响应。
- `ExecCodexAdapter` 不实现 compact，Bridge 应显示不支持。

### 真实通道测试

微信或飞书私聊：

```text
/compact
/compact confirm
/status
```

验证：

- 能收到开始通知。
- 能收到完成/失败通知。
- 压缩中发送 `/stop` 或普通消息会被拒绝。
- 压缩后普通消息仍使用同一个 session 回复。

## 风险

- Codex app-server 可能暂未暴露 compact API。必须先确认协议，不猜方法名。
- 压缩可能耗时较长，期间用户可能继续发送消息。第一版拒绝同 route 输入，避免上下文竞态。
- 压缩失败后的 thread 状态由 Codex 决定。Bridge 只能报告失败，不应尝试自行修复上下文。
- 如果未来支持可取消 compact，必须确认 Codex 侧取消是事务化的，否则不能复用 `/stop`。

## 实施顺序

1. 扩展 `CodexAdapter.compactSession?()` 类型。
2. 实现 `MockCodexAdapter` 测试能力。
3. 新增 `compact-command.ts` 和 Bridge compact 状态。
4. 接入 command router、busy guard、status/help。
5. 实现 `AppServerCodexAdapter.compactSession()`，调用 `thread/compact/start` 并等待完成通知。
6. 更新 README 和测试报告。
7. 跑定向测试和 `npm test`。
