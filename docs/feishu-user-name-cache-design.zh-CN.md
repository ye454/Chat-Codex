# 飞书用户名称解析与缓存设计

## 背景

飞书入站事件里稳定携带的是用户 ID，例如 `sender.sender_id.open_id`。用户昵称或姓名字段不是所有事件、所有应用权限下都保证存在。

这会导致旧绑定或缺少名称字段的飞书机器人在运行日志里只能显示：

```text
飞书 <= ou_xxx
```

这对用户不友好，也会影响后续群聊投递给 Codex 时的发言人前缀。理想表现是：

```text
飞书 <= 私聊:小黄 | 小黄
飞书 <= 群聊:研发群 | 张三
```

如果确实拿不到名称，也至少要固定成清晰的兜底格式：

```text
飞书 <= 私聊:oc_xxx | ou_xxx
飞书 <= 群聊:oc_group_xxx | ou_xxx
```

## 目标

1. 兼容旧版本已经绑定的飞书机器人和旧 route，不要求重新绑定 session。
2. 飞书私聊、群聊日志优先显示用户名称，拿不到时清楚显示 `chat_id + open_id`。
3. 群聊投递给 Codex 的 `小黄说：`、`小黄补充：` 使用同一套名称解析结果。
4. 名称解析失败不影响消息收发、route 配对、session 绑定和审批。
5. 用户改名不做实时同步，但缓存不能永久僵死。

## 非目标

- 不用显示名做权限主键。
- 不因为缺少名称阻断消息。
- 不要求用户重新绑定旧 session。
- 不做后台全量刷新通讯录。
- 不做复杂改名追踪；只做事件覆盖和 TTL 懒刷新。

## 名称解析优先级

入站飞书消息映射 `ChannelMessage.sender.displayName` 时按以下顺序：

1. **事件自带名称**：`sender.sender_name`、`sender.name`、`sender.user_name`，取第一个非空值。
2. **本地名称缓存**：按 `channelId + accountId + open_id` 查缓存。
3. **历史 route 身份**：如果该 route 已有 `identity.lastSenderDisplayName`，可作为兼容兜底。
4. **飞书用户信息接口**：使用 `open_id` 主动查询用户基础资料。
5. **最终兜底**：使用 `sender.id/open_id`。

事件自带名称永远优先，并覆盖缓存。这样如果飞书事件已经给出新名称，改名可以自然更新。

## 缓存作用域

`open_id` 只在同一个飞书应用视角下稳定，不应做全局缓存。

缓存 key 必须至少包含：

```text
channelId + accountId + openId
```

推荐文件位置：

```text
~/.chat-codex/state/channels/feishu/<channelId>/accounts/<accountId>/user-names.json
```

建议结构：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-20T00:00:00.000Z",
  "users": [
    {
      "openId": "ou_xxx",
      "displayName": "小黄",
      "source": "event",
      "lastResolvedAt": "2026-05-20T00:00:00.000Z",
      "lastSeenAt": "2026-05-20T00:00:00.000Z",
      "expiresAt": "2026-06-19T00:00:00.000Z"
    }
  ]
}
```

字段说明：

- `openId`：飞书 `sender_id.open_id`，缓存主键。
- `displayName`：用户名称。可以为空字符串，表示查过但没有权限或没有结果。
- `source`：`event`、`cache`、`api`、`route-history`。
- `lastResolvedAt`：最近一次通过事件或 API 得到名称的时间。
- `lastSeenAt`：最近一次看到该用户发消息的时间。
- `expiresAt`：懒刷新过期时间。

## TTL 与改名策略

建议默认 TTL：30 天。

更新规则：

- 事件自带非空名称：立即覆盖缓存，并重置 TTL。
- 缓存命中且未过期：直接使用缓存，不调用 API。
- 缓存过期：本次可以先使用旧名称，同时异步或同步 best-effort 重新查询；第一版可以同步查询，但失败不能阻断消息。
- API 查询成功：覆盖缓存，并重置 TTL。
- API 查询失败或无权限：缓存空名称一段较短 TTL，例如 1 天，避免每条消息都重复打接口。

用户改名不做强实时。改名后的更新来源有两个：

1. 后续事件自带新名称时覆盖。
2. TTL 到期后懒查询刷新。

## 飞书 API 方案

优先使用用户基础资料接口，按 `open_id` 查询。

可参考本地 `references/openclaw-lark/src/messaging/inbound/user-name-cache.ts` 的做法：

- 单用户：`contact.user.get`，参数 `user_id_type=open_id`。
- 批量：`contact.user.batch` 或对应 `/open-apis/contact/v3/users/batch`。

第一版建议：

- 入站单条消息缺名称时，先实现单用户查询。
- 后续群聊 mentions 或群成员列表再做 batch pre-warm。

权限要求：

- 如果应用没有用户基础资料读取权限，接口可能返回权限错误。
- 权限错误只进入日志和状态提示，不影响消息投递。
- 不在聊天里主动刷屏提示权限错误；最多在 TUI 状态详情或 debug 日志里展示最近一次解析失败原因。

## 旧绑定兼容

旧版本已经发现或绑定的飞书 route 可能只有：

```json
{
  "routeKey": "feishu-main:default:direct:oc_xxx",
  "conversationId": "oc_xxx",
  "identity": {
    "lastSenderId": "ou_xxx"
  }
}
```

兼容规则：

- 不迁移、不要求重新配对、不解绑 session。
- 下一次该 route 收到消息时，按新名称解析流程补齐 `sender.displayName`。
- `FileStateStore.recordRouteMessage()` 继续把最新 `lastSenderDisplayName` 写入 `routes.json`。
- 如果缓存里已经有 `openId -> displayName`，旧 route 下一条消息即可显示名称。

## 日志兜底格式

运行期终端和 Runtime TUI 必须统一使用同一套 transcript formatter。

飞书私聊：

```text
飞书 <= 私聊:<displayName 或 chat_id> | <displayName 或 open_id>
飞书 => 私聊:<displayName 或 chat_id>
```

飞书群聊：

```text
飞书 <= 群聊:<群名 或 chat_id> | <displayName 或 open_id>
飞书 => 群聊:<群名 或 chat_id>
```

如果没有名称，不允许退化成只有：

```text
飞书 <= ou_xxx
```

至少必须保留会话类型和 `chat_id`：

```text
飞书 <= 私聊:oc_xxx | ou_xxx
```

## 对群聊 Codex 投递的影响

群聊发言人前缀使用同一套 `sender.displayName`：

```text
小黄说：这里是内容
小红补充：这里是内容
```

如果名称解析失败：

```text
ou_xxx说：这里是内容
ou_xxx补充：这里是内容
```

私聊仍不加 `小黄说：` 前缀。

## 模块设计

建议新增模块：

```text
src/channels/feishu/feishu-user-name-cache.ts
```

职责：

- 读写 `user-names.json`。
- `seedUserName(openId, displayName, source)`：事件自带名称时写入。
- `getCachedUserName(openId)`：缓存命中且未过期时返回。
- `resolveUserName(openId)`：缓存 miss 时 best-effort 调飞书 API。
- 记录最近失败原因，但不抛给 Bridge。

`FeishuAdapter.handleIncomingEvent()` 的建议流程：

```text
event -> feishuEventToChannelMessage 基础映射
      -> 如果 sender.displayName 为空，尝试名称缓存/API
      -> 补齐 ChannelMessage.sender.displayName
      -> 下载附件
      -> handler(message)
```

如果为了减少职责耦合，也可以把名称解析前置到 `feishuEventToChannelMessage()` 之前，但不要让纯映射函数直接依赖 SDK 或文件系统。推荐 adapter 负责 enrichment，message mapper 保持纯函数。

## 测试计划

至少补以下测试：

- 事件自带 `sender_name` 时，写入并优先使用该名称。
- 事件无名称但缓存命中时，日志和群聊 prompt 使用缓存名称。
- 事件无名称且缓存 miss 时，调用飞书用户信息接口，成功后写入缓存。
- API 权限失败时，不阻断消息，日志回退 `open_id`。
- 旧 route 只有 `lastSenderId` 时，下一条消息可补齐 `lastSenderDisplayName`。
- 私聊日志无名称时显示 `私聊:oc_xxx | ou_xxx`，不能退化成 `飞书 <= ou_xxx`。
- 群聊 `小黄说/补充` 使用解析后的名称。
- 私聊普通 prompt 不增加发言人前缀。

## 实施顺序

1. 修正 transcript 兜底格式，确保私聊/群聊类型和 `chat_id` 永远可见。
2. 增加内存级名称缓存，先覆盖运行期体验。
3. 增加 `user-names.json` 持久化缓存，兼容重启和旧 route。
4. 增加飞书 API 主动解析，失败时降级为 `open_id`。
5. 把解析结果接入群聊 Codex prompt 前缀和 TUI 列表展示。

