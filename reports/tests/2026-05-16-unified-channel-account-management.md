# 测试报告：统一渠道账号管理与聊天绑定

日期：2026-05-16

## 目标

验证 `chat-codex` 主入口的核心交互层已经按当前设计落地：

- 微信账号可以作为独立渠道实例添加，并在添加后设置微信主聊天 session。
- 飞书机器人可以作为独立渠道实例添加，但不做渠道级 session 绑定。
- 启动服务时从本地配置启动所有已启用渠道。
- 聊天绑定通过编号选择 session，错误 ID 可恢复。
- 同一个 Codex session 只能被一个真实 route 或 pending 绑定占用。
- session 级权限和 pending 微信主聊天绑定可以持久化。

## 覆盖点

- `ChannelActions` 注册多个微信账号和多个飞书机器人，生成独立渠道实例和状态目录。
- `ChannelActions.createRuntimeAdapters()` 只创建 enabled 渠道适配器。
- `FileStateStore` 持久化 `pending-bindings.json`，并为 existing pending session 预留 owner。
- Bridge 收到第一条微信私聊后消费 pending 绑定，把 owner 从 pending route 转移到真实 route。
- `SessionBindings` 在 route 切换 session 后释放旧 active session 的 owner，避免旧 session 永久占用。
- 首页和聊天绑定菜单不再展示旧的“Codex 默认设置”和默认“首个微信私聊”入口。

## 验证命令

```bash
npm run test:unit
npm run test:integration
npm test
git diff --check
```

另执行本地密钥扫描，检查真实飞书 App ID / App Secret 和长 secret 模式未进入仓库文件。

## 结果

- `npm run test:unit`：110 passed，0 failed。
- `npm run test:integration`：69 passed，0 failed。
- `npm test`：179 passed，0 failed。
- `git diff --check`：通过。
- 密钥扫描：未发现飞书 App Secret 或长 secret 明文。

## 备注

当前未做 TUI；TUI 仍按设计作为后续展示层，业务动作继续走 actions/services。
