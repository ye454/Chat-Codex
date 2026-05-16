# CLI 交互重设计

## 背景

改造前，`weixin codex` 已经改为进入轻量渠道向导，但交互结构仍混有旧版直连入口的习惯：

- 启动前先问 Codex 默认项，再处理微信渠道。
- session 选择容易出现在用户还没理解“渠道”和“聊天绑定”的时候。
- 首页虽然中文化了，但更像状态摘要，不像一个可进入、可返回、可退出的管理模式。
- “首个微信私聊绑定已有 session”改造前只是把 `initialSessionId` 暂存在 Bridge，等第一条普通消息到来时才消费，用户容易误以为已立即绑定。

新的目标是把 CLI 做成一个清晰的交互模式：用户进入后先管理渠道，再管理聊天绑定和 Codex 默认设置；每个页面都可以返回；只有用户明确选择绑定/切换时才出现 session 列表。

本轮实现只做普通 CLI 交互重构；旧版 `weixin codex-direct` 全局直连入口移除。全屏 TUI 只作为未来方向记录在本文，不在本轮实现。

## 设计原则

1. 先渠道，后 session。
   用户启动的是“把 Codex 接到微信/渠道”，不是先选择一个 Codex session。

2. 顶层是可返回的管理首页。
   所有子页面都支持 `0. 返回`；顶层支持 `0. 退出`。

3. session 只在需要时出现。
   只有进入“聊天绑定”或“选择 session”时才展示 session 列表。

4. 所有选择都应可恢复。
   输入错误不直接崩溃；提示当前可用选择，并允许重新输入或返回。

5. 启动前配置和运行中聊天绑定语义一致。
   CLI 选择“第一个微信私聊绑定已有 session”必须和微信内 `/resume` / `/use` 使用同一套 owner 冲突检测和绑定语义。

6. 默认路径短。
   单用户私有部署的推荐路径应是：进入首页 -> 微信已登录/扫码 -> 使用默认新聊天策略 -> 启动服务。

## 顶层首页

目标首页：

```text
Codex Chat Bridge

渠道
- 微信: 已登录 wx_xxx

聊天绑定
- 新聊天策略: 首条消息自动创建新 session
- 首个微信私聊: 未预设

Codex 默认设置
- 接入方式: Codex app-server
- 权限模式: 审批模式
- 阶段进度: 微信不投递，终端记录
- 并发上限: 不限制不同聊天并行

请选择：
1. 管理渠道
2. 聊天绑定
3. Codex 默认设置
4. 状态详情
5. 启动服务
0. 退出
```

推荐顺序是 `渠道 -> 聊天绑定 -> Codex 默认设置 -> 状态详情 -> 启动服务`，原因：

- 渠道决定“消息从哪里来”。
- 聊天绑定决定“新消息如何进入 Codex session”。
- Codex 默认设置只影响后续新会话和任务，是次级配置。
- 状态详情是诊断入口，不应成为主路径。
- 启动服务应该是用户确认配置后的显式动作。

## 渠道模式

进入 `1. 管理渠道`：

```text
渠道

1. 微信    已登录 wx_xxx
2. 重新登录微信
3. 查看微信状态
4. 添加渠道
0. 返回
```

当前 MVP 只实现微信：

- 已登录时不强制扫码。
- 未登录时可以在渠道模式里扫码登录。
- 登录成功后回到渠道页面或首页，不直接进入 session 列表。
- 飞书等未来渠道只展示“未实现”，不影响当前微信启动路径。

## 聊天绑定模式

进入 `2. 聊天绑定`：

```text
聊天绑定

新聊天策略
- 当前: 首条消息自动创建新 session

首个微信私聊
- 当前: 未预设

请选择：
1. 设置新聊天策略
2. 设置首个微信私聊绑定
3. 查看当前绑定
0. 返回
```

### 新聊天策略

```text
新聊天策略

1. 首条消息自动创建新 session（推荐单用户私有部署）
2. 首条消息先提示 /new 或 /resume（推荐多用户或多聊天）
0. 返回
```

这只决定尚未绑定 route 的普通消息如何处理。

### 首个微信私聊绑定

```text
首个微信私聊绑定

1. 不预设，按新聊天策略处理
2. 启动后第一个私聊绑定已有 session
3. 启动后第一个私聊创建新 session
0. 返回
```

选择 `2` 时才进入 session 选择。

## Session 选择模式

```text
选择 Codex session

0. 返回
1. cdx-aaa  修复登录问题...
2. cdx-bbb  README 调整...
3. 手动输入 Session ID
```

规则：

- 标题展示必须省略，避免撑开终端。
- 手动输入 ID 错误时不崩溃，回到选择列表并提示错误。
- 已被其他 route 拥有的 session 不应作为可绑定项展示；如果手动输入则拒绝并说明 owner 冲突。
- 成功选择后回到“聊天绑定”模式，不立即启动服务。

## Codex 默认设置模式

```text
Codex 默认设置

1. 接入方式: Codex app-server
2. 权限模式: 审批模式
3. 新 session 工作目录: /path/to/repo
4. 并发上限: 不限制不同聊天并行
0. 返回
```

这些设置是“默认项”，不是全局 session 绑定：

- 工作目录用于后续创建新 session。
- 权限模式用于后续 turn 或新 session 的默认策略。
- `app-server` 仍是推荐接入方式。
- `exec` 只作为回退。

## 启动确认

用户选择 `5. 启动服务` 时输出最终确认：

```text
即将启动

渠道
- 微信: 已登录 wx_xxx

聊天绑定
- 新聊天策略: 首条消息自动创建新 session
- 首个微信私聊: 未预设

Codex 默认设置
- 接入方式: Codex app-server
- 权限模式: 审批模式
- 新 session 工作目录: /path/to/repo

1. 启动
0. 返回
```

启动后打印运行摘要，并进入常驻服务。

## 当前 Bug：CLI 绑定 session 语义不清

改造前现状：

- `bind_existing_first_route` 会把选择结果放进 `Bridge.initialSessionId`。
- `initialSessionId` 只有在第一条未绑定 route 的普通消息进入 `ensureSession()` 时才真正绑定。
- 如果用户启动后先发 `/status`，看不到当前聊天已绑定，因为还没有普通消息触发绑定。
- 如果用户启动后先发 `/new` 或 `/resume`，当前 route 会绑定到用户命令指定的 session，但 `initialSessionId` 仍可能保留，后续其他 route 的普通消息可能错误消费这个预设 session。

这会造成用户感知上的“CLI 里选了 session 但不生效”，也可能造成预设 session 被错误 route 消费。

目标修复：

1. `initialSessionId` 改为显式的 pending first-route binding 状态。
2. 该状态只允许被第一个符合条件的微信私聊 route 消费。
3. 当前 route 通过 `/new`、`/resume`、`/use` 明确绑定 session 后，若它是第一个待绑定 route，应清理 pending 状态。
4. 如果 pending session 被其他 route 拥有或 resume 失败，应提示并回退到新聊天策略，不应静默失败。
5. 首页和启动摘要不要说“已绑定”，应说“首个私聊将绑定到已选 session”。

本轮实现状态：

- CLI 传给 Bridge 的启动预设已从旧式全局 `initialSessionId` 改为 `initialRouteBinding`。
- pending 预设会先归属到第一个微信私聊 route；该 route 发送 `/status` 时会显示“待绑定首个私聊预设”，不会让其他私聊误消费。
- 该 route 通过 `/new`、`/resume`、`/use` 明确绑定后会清理 pending 预设。
- 启动首页和启动摘要只展示“首个微信私聊预设”，不再把它算作已绑定 session。

## 实施顺序

### P1：结构化 CLI 模式

- 引入顶层首页循环。
- 拆出渠道模式、聊天绑定模式、Codex 默认设置模式。
- 每个模式支持 `0. 返回`。
- 保留非交互模式的现有行为。

### P2：绑定语义修复

- 将 `initialSessionId` 改为 pending first-route binding。
- 限定只被首个微信私聊 route 消费。
- 在 `/new`、`/resume`、`/use` 明确绑定时清理对应 pending 状态。
- 调整启动摘要文案，区分“预设”和“已绑定”。

### P3：会话选择体验

- CLI session 选择和微信 `/use` / `/resume` 编号选择共享展示规则。
- 长标题省略。
- 错误输入可恢复。
- owner 冲突在选择列表中过滤，在手动输入时清晰提示。

### P4：测试和文档

- 单元测试覆盖各模式 parse/format。
- 集成测试覆盖 pending first-route binding 被正确消费和清理。
- README 更新默认启动路径。
- 测试报告记录手工验证项。

## 验收标准

- `npm run cli:weixin:codex` 不再先问 session。
- 用户可以从首页进入/退出每个配置模式。
- 微信未登录时，渠道模式能引导扫码；扫码后回到模式页。
- 用户只有在“聊天绑定”里明确选择时才看到 session 列表。
- 预设首个私聊 session 后，第一条微信私聊普通消息确实绑定该 session。
- 先发 `/new`、`/resume`、`/use` 不会让 pending session 泄漏给其他 route。
- 全量测试通过，`git diff --check` 通过。
