# 测试报告：TUI 核心功能完善

## 测试目标

验证 `tui-core-functionality-followups.zh-CN.md` 中的核心功能补齐：

1. 渠道支持备注名持久化和修改。
2. 渠道支持删除，并清理该渠道 routes、pending bindings 和 session owner。
3. 禁用渠道不解绑 session。
4. 渠道列表和详情展示添加时间、更新时间。
5. 绑定 session 时展示 Codex session 最近活跃时间。
6. 运行期 TUI 日志正文不再截断，仍只保留最近 300 条。
7. 飞书添加连通性校验保持现有 `probeOnStart: true` 行为。

## 测试环境

- 日期：2026-05-16
- 分支：main
- Node.js：项目要求 Node.js >= 22
- 操作系统：macOS
- 渠道：unit mock / TUI component test

## 执行命令

```bash
npm run build
node --test dist/tests/unit/file-state-store.test.js dist/tests/unit/channel-actions.test.js dist/tests/unit/binding-actions.test.js dist/tests/unit/ink-tui.test.js
npm test
```

## 覆盖用例

- `ChannelConfigStore` 持久化 `displayName`，修改备注不改变 `createdAt`。
- `ChannelConfigStore.removeChannelInstance()` 删除渠道配置和该渠道 stateDir。
- `FileStateStore.removeChannelState()` 删除指定渠道 routes。
- 删除渠道时 active session owner 被释放。
- 删除渠道时 pending existing session owner 被释放。
- 删除一个渠道不影响另一个渠道的配置和状态目录。
- `ChannelActions.renameChannel()` 和 `ChannelActions.removeChannel()` 组合调用持久化层和状态层。
- `BindingActions.formatSessionChoices()` 输出 session 最近活跃时间。
- Ink TUI 聊天绑定列表和详情展示最近活跃时间。
- Runtime TUI 对长日志正文保留完整尾部内容，不渲染成截断省略。
- Runtime log store 超过 300 条后只保留最近 300 条。
- Runtime TUI 支持 `c` 清空当前面板日志。
- Runtime TUI 在非交互渲染时不会因 `useInput` 要求 raw mode 而影响 `SIGINT` 测试。

## 实际结果

- `npm run build` 通过。
- 定向测试通过：28 passed，0 failed。
- `npm test` 通过：213 passed，0 failed。

## 结论

通过。

## 遗留问题

- 本次未执行真实飞书 App ID / App Secret 端到端连通性验证；现有代码路径仍保持添加飞书时先 `probeOnStart: true`，失败不登记渠道。
- 本次未进行真实终端人工 TUI 删除渠道验证；已通过 Ink 组件测试和 actions/state 单测覆盖核心逻辑。
