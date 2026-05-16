# 核心 CLI 绑定交互与 session 权限测试报告

日期：2026-05-16

## 覆盖范围

- 普通 CLI 聊天绑定入口接入 `BindingActions`。
- 首页去掉 `Codex 默认设置` 分区，只展示新 session 默认权限。
- 权限设置页只保留审批模式/完全权限，不再展示接入方式、阶段进度和并发上限。
- 已发现聊天可进入绑定详情。
- 切换 session 使用编号选择或手动输入 Session ID。
- 输入不存在的 Session ID 返回可恢复中文错误，不抛原始异常。
- 已被其他 route owner 占用的 session 不进入可选列表，并显示在不可选区。
- 当前 session 权限可单独设置并持久化到 `session-policies.json`。
- Bridge 恢复已绑定 session 时会应用持久化 session 权限。

## 执行命令

```bash
npm run test:unit
npm run test:integration
npm test
git diff --check
```

## 结果

- `npm run test:unit`：106 passed，0 failed
- `npm run test:integration`：68 passed，0 failed
- `npm test`：174 passed，0 failed
- `git diff --check`：通过

## 说明

- 本次没有实现 TUI，只落普通 CLI 的核心 actions/services 和可测试行为。
- TUI 视觉与交互规范已写入 `docs/cli-core-interaction-design.zh-CN.md`，后续只作为展示层接入 actions。
