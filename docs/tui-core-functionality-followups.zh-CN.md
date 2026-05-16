# TUI 核心功能完善设计

## 背景

当前 `chat-codex` 已经有统一 TUI 入口、渠道管理、聊天绑定、默认权限、默认工作目录和运行期日志面板。但还有一批核心功能缺口会直接影响日常使用，不属于视觉样式优化，应优先进入实现队列。

本文档单独记录这些后续项，编号沿用讨论中的问题编号。

范围：

- 渠道删除。
- 渠道备注名。
- 渠道添加时间展示。
- 禁用渠道和删除渠道的绑定语义。
- session 最近活跃时间展示。
- 飞书添加时连通性校验的既定行为。
- 运行期日志完整展示。

不在本文范围：

- TUI 颜色、边框、整体视觉风格。
- 群聊、thread、媒体、飞书卡片聚合。
- 给已有 Codex session 修改工作目录。
- 一个 Codex session 绑定多个工作目录。

## 总原则

- TUI 仍然只是 UI 层，不能直接读写 Bridge 状态目录下的 JSON 文件或直接操作渠道 adapter。
- TUI 和普通 prompt CLI 必须复用同一套 `LauncherActions`、`ChannelActions`、`BindingActions` 和 state store 能力。
- 备注名、删除渠道、解绑 session owner 等业务动作必须先落到 actions/services，再由 TUI/CLI 调用。
- 禁用是可恢复操作；删除是破坏性操作，必须二次确认。
- 删除渠道不能删除 Codex session 本体，只能释放这个渠道占用的绑定关系。
- App Secret、token、cookie 等密钥不能出现在 TUI、日志、测试报告或 Git 跟踪文件里。

## 9. 渠道删除与备注名

### 备注名

每个渠道实例需要有一个用户可改的展示名，用于区分多个微信账号或多个飞书机器人。

建议数据模型：

```ts
interface ChannelInstanceRecord {
  id: string;
  type: string;
  enabled: boolean;
  stateDir: string;
  defaultAccountId?: string;
  displayName?: string;
  credentialSource?: string;
  createdAt: string;
  updatedAt: string;
}
```

展示优先级：

```text
displayName > status.account > defaultAccountId > id
```

规则：

- 备注名只是展示名，不改变 `channelId`、`accountId`、state 路径或 routeKey。
- 微信和飞书都支持修改备注名。
- 备注名允许为空；清空后回退到账号或实例 ID。
- 备注名不属于 secret，可以持久化。
- 飞书“账号标识”仍是创建时的稳定本地标识；本期不做重命名账号标识迁移。

TUI 渠道页操作：

```text
操作
> 添加微信账号
  添加飞书机器人
  修改选中渠道备注
  启用/停用选中渠道
  删除选中渠道
  查看选中渠道详情
  返回首页
```

渠道详情展示：

```text
类型: 飞书
备注: 大龙虾
账号标识: dalongxia
实例: feishu-dalongxia
状态: 已连接
添加时间: 2026-05-16 14:20
更新时间: 2026-05-16 14:25
```

普通 CLI fallback 也要提供同样能力：

- 修改渠道备注。
- 删除渠道。
- 渠道详情显示备注和添加时间。

### 删除渠道

删除渠道表示这个渠道实例从本地 Chat Codex 配置中移除。

删除渠道必须做二次确认，确认文案要明确影响范围：

```text
确认删除 飞书 / 大龙虾？
这会删除该渠道配置、本机渠道状态目录、已发现聊天记录、待生效绑定，并释放相关 session 占用。
不会删除 Codex session 本体。
```

删除时应清理：

- Bridge 状态目录 `config.json` 里的渠道实例。
- 该渠道的 `stateDir`，包括微信账号状态或飞书本机凭证文件。
- `routes.json` 中 `channelId` 等于该渠道的 routes。
- routes 上的 active session 绑定。
- `session-owners.json` 中由这些 routes 占用的 owner。
- `pending-bindings.json` 中属于该渠道的 pending bindings。
- pending existing session 对应的 owner 预留。

删除时不清理：

- Codex 历史 session 文件。
- Codex session 内容。
- session 级权限记录。权限是 session 维度，如果用户之后重新绑定同一个 session，可以继续沿用。

删除结果应返回结构化摘要，供 TUI/CLI 展示：

```ts
interface RemoveChannelResult {
  ok: true;
  channelId: string;
  removedRoutes: number;
  releasedSessions: number;
  removedPendingBindings: number;
  removedStateDir: boolean;
  message: string;
}
```

## 10. 飞书添加时连通性校验

这个行为已经进入当前实现方向，需要作为固定设计保留。

添加飞书机器人时：

- 用户手动输入 App ID。
- 用户手动输入 App Secret，输入框不回显。
- 用户输入账号标识，必填，用于区分多个机器人。
- 飞书域默认 `feishu`，普通用户不需要配置。
- 提交后先校验连通性。
- 校验成功才注册渠道。
- 校验失败不注册渠道，停留在表单并显示中文错误。

连通性校验至少包括：

- 凭证字段完整。
- 能获取机器人身份或完成等价 probe。
- adapter 状态为 `connected`。

日志要求：

- 不打印 App Secret。
- 不打印 token、authorization、cookie。
- 错误文案只显示可行动原因，例如凭证缺失、认证失败、网络不可达。

## 11. 绑定 session 时显示最近活跃时间

Codex 历史 session 已能通过 `discoverCodexSessions()` 读取 `updatedAt`，这个时间应展示给用户。

展示位置：

- 聊天绑定列表：已绑定 session 旁显示最近活跃时间。
- 绑定详情：显示当前 session 最近活跃时间。
- 选择已有 session 页：每个可选和不可选 session 都显示最近活跃时间。
- 微信主聊天绑定页：可选 session 和不可选 session 也显示最近活跃时间。

显示文案：

```text
当前 session: CLI 交互重构 / 019e2ea9
最近活跃: 2026-05-16 14:32
工作目录: /path/to/project
```

列表行示例：

```text
> 1. 可用   CLI 交互重构          019e2ea9   最近 05-16 14:32
  2. 可用   微信登录优化          019e2ca0   最近 05-15 23:10
```

规则：

- `session.updatedAt` 表示 Codex session 最近活跃时间。
- `route.lastSeenAt` 表示聊天最近收到消息时间。
- 两者不能混为一个字段。
- 缺失 `updatedAt` 时显示 `最近活跃: 未知`。
- 排序仍优先按 `updatedAt` 从新到旧。

## 12. 禁用渠道是否解绑 session

设计结论：

```text
禁用渠道不解绑 session。
删除渠道才清理绑定并释放 session owner。
```

原因：

- 禁用是临时停用。用户可能只是暂时不启动某个微信账号或飞书机器人。
- 禁用后保留聊天绑定，重新启用后能继续使用原 session。
- 如果禁用自动解绑，会导致用户误丢绑定关系，也可能让 session 被别的 route 抢走。

禁用渠道时：

- 渠道不参与本次启动。
- route、pending binding、session owner 全部保留。
- 聊天绑定页仍可看到该渠道的历史聊天，但需要标注渠道已停用。
- 用户仍可手动解绑某个聊天。

删除渠道时：

- 渠道配置被移除。
- 该渠道 routes 被删除。
- 该渠道 active session owner 被释放。
- 该渠道 pending bindings 被删除。
- 该渠道本机状态目录被删除。

TUI 文案要区分：

```text
停用：暂时不启动这个渠道，保留绑定。
删除：移除渠道和绑定记录，释放 session 占用。
```

## 13. 添加时间展示

渠道实例已经有 `createdAt` 和 `updatedAt` 字段，应在 UI 中展示。

展示位置：

- 管理渠道列表：可以显示简短添加时间。
- 渠道详情：显示完整添加时间和更新时间。
- 状态详情：显示添加时间。

示例：

```text
微信 / 小号        已启用   已连接   添加 05-16 14:20
飞书 / 大龙虾      已启用   已连接   添加 05-16 14:24
```

规则：

- 时间显示使用本机时区。
- 列表使用短格式：`05-16 14:20`。
- 详情使用完整格式：`2026-05-16 14:20:31`。
- 旧状态如果缺少 `createdAt`，回退到 `updatedAt`；仍没有则显示 `未知`。

## 14. 运行期日志完整展示

运行期 TUI 目前内存里保留日志，但正文渲染会截断。后续应改为消息正文完整展示。

保留规则：

- 内存里仍只保留最近 300 条日志。
- 新日志超过 300 条时丢弃最旧日志。
- 日志正文不因 300 条限制以外的原因被裁剪。

渲染规则：

- 消息正文不使用 `truncate()`。
- 正文按终端宽度自动换行。
- 多行消息逐行展示。
- source、chat id、路径等定位信息可以在列表头部适度缩短，但正文必须完整。
- 密钥字段仍要脱敏。

交互规则：

- 默认跟随最新日志。
- `Up` / `Down`：滚动查看日志。
- `PageUp` / `PageDown`：按页滚动。
- `End`：回到底部并恢复自动跟随。
- `c`：清空当前 TUI 面板日志，不影响 Bridge 业务状态。
- `Ctrl+C`：停止服务并退出。

运行期 footer：

```text
↑↓ 滚动  PgUp/PgDn 翻页  End 最新  c 清屏  Ctrl+C 停止服务
```

日志类型：

- 系统：启动、停止、渠道状态。
- 收到：微信/飞书入站消息。
- 发送：出站回复。
- 进度：Codex 阶段性进度。
- 媒体：文件或图片发送。
- 错误：异常和失败原因。

## Actions / State 设计

### ChannelConfigStore

需要新增能力：

```ts
setChannelDisplayName(id: string, displayName?: string): ChannelInstanceRecord | undefined;
removeChannelInstance(id: string, options?: { removeStateDir?: boolean }): RemoveChannelConfigResult;
```

`upsertChannelInstance()` 要保留已有 `displayName`，除非显式传入新值。

### FileStateStore

需要新增按渠道清理状态的能力：

```ts
removeChannelState(channelId: string): RemoveChannelStateResult;
```

职责：

- 删除该渠道 routes。
- 对每个 active route 调用解绑逻辑或等价释放 owner。
- 删除该渠道 pending bindings。
- 释放 pending existing session owner。
- 持久化 routes、session owners、pending bindings。

### ChannelActions

需要新增：

```ts
renameChannel(id: string, displayName?: string): ChannelInstanceRecord | undefined;
removeChannel(id: string): RemoveChannelResult;
```

`removeChannel()` 组合调用：

- `ChannelConfigStore.removeChannelInstance()`
- `FileStateStore.removeChannelState()`

### LauncherActions

需要透出给 TUI/CLI：

```ts
renameChannel(id: string, displayName?: string): Promise<ManagedChannelSummary | undefined>;
removeChannel(id: string): Promise<RemoveChannelResult>;
```

## TUI 页面改动

### 管理渠道页

渠道列表显示：

```text
> 飞书 / 大龙虾        已启用   已连接   添加 05-16 14:24
  微信 / 小号          已停用   已连接   添加 05-16 13:50
```

操作区显示：

```text
操作
  添加微信账号
  添加飞书机器人
  修改选中渠道备注
  启用/停用选中渠道
  删除选中渠道
  查看选中渠道详情
  返回首页
```

### 渠道详情页

需要展示：

- 类型。
- 备注名。
- 账号标识。
- 实例 ID。
- 启用状态。
- 连接状态。
- 添加时间。
- 更新时间。
- 最近错误。

需要操作：

- 修改备注。
- 启用/停用。
- 删除渠道。
- 微信：设置主聊天绑定。
- 飞书：输入/更新凭证。

### 删除确认

删除前弹出二次确认。确认后停留在管理渠道页，状态栏显示摘要：

```text
已删除 飞书 / 大龙虾：移除 3 个聊天，释放 2 个 session，占用待生效绑定 1 个。
```

### 聊天绑定页

对已停用渠道的聊天加标识：

```text
飞书 / 大龙虾 / 张三    已停用渠道    日报任务 / 019e2ea9   最近活跃 05-16 14:32
```

## CLI fallback 改动

普通 prompt CLI 必须能完成同样核心动作：

- 管理渠道列表显示备注名和添加时间。
- 渠道详情显示备注、添加时间、更新时间。
- 提供“修改备注”。
- 提供“删除渠道”，并二次确认。
- 禁用提示明确“不解绑 session”。
- 绑定 session 列表显示最近活跃时间。
- 运行期日志在非 TTY 下继续用现有 transcript 输出，不强制全屏 TUI。

## 测试要求

单元测试：

- `ChannelConfigStore` 持久化 `displayName`，更新备注不改变 `createdAt`。
- `ChannelConfigStore.removeChannelInstance()` 移除 config 记录，并按选项移除 stateDir。
- `FileStateStore.removeChannelState()` 删除指定渠道 routes。
- 删除渠道时 active session owner 被释放。
- 删除渠道时 pending existing session owner 被释放。
- 禁用渠道不删除 route、不解绑 session、不释放 owner。
- `BindingActions` 格式化 session 最近活跃时间。
- TUI session 列表展示最近活跃时间。
- Runtime TUI 对长消息正文不出现省略号截断。
- Runtime log store 仍只保留最近 300 条。

集成测试：

- 添加两个渠道，删除其中一个，不影响另一个渠道。
- 删除带 active binding 的渠道后，同一个 session 可以绑定到其他 route。
- 删除带 pending 微信主聊天绑定的渠道后，pending owner 被释放。
- 禁用再启用渠道后，原聊天绑定仍存在。

人工验证：

```bash
npm run chat-codex
```

重点验证：

- 渠道页可以用方向键和 Enter 修改备注。
- 渠道页可以用方向键和 Enter 删除渠道。
- 删除渠道前有明确确认。
- 删除渠道后首页、渠道页、聊天绑定页都刷新正确。
- 禁用渠道后绑定仍保留。
- 绑定 session 时能看到最近活跃时间。
- 渠道详情能看到添加时间。
- 运行期日志能完整显示长消息和多行消息。
- 运行期日志超过 300 条后只保留最近 300 条。

## 实施顺序

1. 扩展持久化类型和 `ChannelConfigStore`：备注名、删除渠道实例、添加时间展示兼容。
2. 扩展 `FileStateStore`：按渠道删除 routes、pending bindings 和释放 owner。
3. 扩展 `ChannelActions` / `LauncherActions`：rename、remove、结构化结果。
4. 更新普通 CLI fallback。
5. 更新 TUI 管理渠道页和渠道详情页。
6. 更新绑定页和 session 选择页，展示最近活跃时间。
7. 更新运行期日志面板：全文展示、滚动、清屏、300 条保留。
8. 补单元测试、集成测试和中文测试报告。

## 验收标准

- 微信和飞书渠道都可以修改备注名。
- 微信和飞书渠道都可以删除。
- 删除渠道会释放该渠道绑定的 session owner。
- 禁用渠道不会解绑 session。
- 渠道列表和详情能看到添加时间。
- 绑定 session 时能看到 session 最近活跃时间。
- 飞书添加失败不会登记不可用渠道。
- 运行期 TUI 日志正文完整展示，不再省略。
- `npm test` 通过。
- 新增测试报告放入 `reports/tests/`。
