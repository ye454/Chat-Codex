# 测试报告：本地文件持久化第一阶段

## 测试目标

验证渠道持久化第一阶段能力：

- route/session 绑定写入 `routes.json`。
- 全局 `sessionId -> ownerRouteKey` 写入 `session-owners.json`。
- 重启后 Bridge 能从文件状态恢复 route 的 active session。
- session owner 仍然全局唯一，跨 route 绑定冲突会被拒绝。
- 渠道实例配置写入 `config.json`，并按渠道/账号拆分目录。
- 配置文件和账号文件不写入真实 secret。

## 测试环境

- 日期：2026-05-16
- 分支：main
- Node.js：由本机 `npm` 测试环境提供
- 渠道：mock / fake Feishu / fake Weixin API

## 执行命令

```bash
npm run test:unit
npm run test:integration
npm test
git diff --check
rg -n "<known-real-feishu-credential-fragments>" README.md docs reports src tests package.json .gitignore
```

## 测试步骤

1. 使用 `FileStateStore` 记录飞书私聊 route 消息并绑定 session。
2. 重新创建 `FileStateStore`，验证能读回 active binding 和 session owner。
3. 用另一个 route claim 同一个 session，验证被 owner 冲突拒绝。
4. 使用 `ChannelConfigStore` 写入飞书和微信渠道实例，验证目录为 `state/channels/<type>/<channelId>/accounts/<accountId>/`。
5. 用 Bridge + MockChannel + MockCodex 发送第一条消息，停止后重新创建 Bridge，再发送第二条消息，验证复用同一个 session。
6. 跑完整单元、集成和全量测试。
7. 扫描仓库文档、源码、测试和报告，确认未写入真实飞书密钥。

## 实际结果

### 单元测试

```text
npm run test:unit
102 passed, 0 failed
```

新增覆盖：

- `FileStateStore persists active route binding and session owner`
- `FileStateStore keeps session owner global across routes after reload`
- `ChannelConfigStore writes channel and account directories without secrets`

### 集成测试

```text
npm run test:integration
67 passed, 0 failed
```

新增覆盖：

- `Bridge restores route session binding from FileStateStore after restart`

### 全量测试

```text
npm test
169 passed, 0 failed
```

### 格式和密钥检查

```text
git diff --check
```

通过。

密钥扫描未发现已知真实飞书 App ID / App Secret 片段；报告不记录真实片段。

## 结论

通过。文件持久化第一阶段已覆盖 route/session 绑定、全局 session owner、Bridge 重启恢复和渠道/账号目录骨架。

## 遗留问题

- CLI 尚未提供完整“管理渠道”和“管理聊天绑定”页面。
- `pending-bindings.json`、schema 迁移、损坏文件恢复和显式释放 owner 仍待后续实现。
- 当前只按单进程本地文件写入设计；多进程并发写不在第一阶段范围内。
