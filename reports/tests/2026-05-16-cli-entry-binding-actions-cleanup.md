# 测试报告：CLI 入口收敛与绑定动作补齐

日期：2026-05-16

## 目标

验证本轮 CLI 收口：

- 删除微信/飞书单渠道 Codex 启动入口暴露，只保留 `chat-codex` 统一入口。
- 普通 CLI 绑定详情补齐“新建并绑定 session”和“解绑当前 session”。
- 首页和启动确认页提示：配置好后，需要启动服务才会真正的工作。
- session 被占用时显示绑定到哪个渠道实例和聊天。

## 覆盖点

- `package.json` 不再暴露 `cli:weixin:codex`、`cli:feishu:codex`、`cli:serve` 和旧 bin alias。
- CLI help 不再展示 `weixin codex`、`feishu codex`、`chat-codex serve`。
- `BindingActions` 覆盖新建绑定、解绑、无效 ID 可恢复、owner 冲突归属显示。
- `SessionBindings` / `FileStateStore` 覆盖解绑后释放 owner 并持久化。
- `serve-wizard` 覆盖“配置好后，需要启动服务才会真正的工作！”提示。

## 验证命令

```bash
npm run test:unit
npm test
git diff --check
```

## 结果

- `npm run test:unit`：113 passed，0 failed。
- `npm test`：182 passed，0 failed。
- `git diff --check`：通过。
