# 测试报告：微信 Codex 启动入口切换到渠道向导

## 测试目标

验证 `npm run cli:weixin:codex` 不再进入旧版“启动前先选择 Codex session”的直连流程，而是进入与 `cli:serve` 一致的轻量渠道管理向导。

同时验证旧版直连入口仍保留为 `npm run cli:weixin:codex:direct`，便于需要启动前显式绑定 session 时回退使用。

## 测试环境

- 日期：2026-05-16 00:34:33 CST
- 分支/提交：`main` / `ab42f01`
- Node.js 版本：`v24.13.1`
- 操作系统：Darwin xiaohuangdeMini 25.3.0 arm64
- Codex 版本：未调用真实 Codex
- 渠道：CLI entry / mock

## 执行命令

```bash
npm run build
node --test dist/tests/unit/cli-entry.test.js dist/tests/unit/serve-wizard.test.js
npm test
git diff --check
```

## 测试步骤

1. 将 `codex-wechat-bridge weixin codex` 路由到 `runServe()`，使 `npm run cli:weixin:codex` 进入渠道向导。
2. 新增 `codex-wechat-bridge weixin codex-direct` 和 `npm run cli:weixin:codex:direct` 作为旧版直连兼容入口。
3. 更新 CLI help，明确 `weixin codex` 是渠道管理向导，`weixin codex-direct` 是旧版直连。
4. 更新 README 和多渠道设计文档，说明启动入口语义。
5. 新增 `tests/unit/cli-entry.test.ts`，锁定 package script 和 CLI help 文案。
6. 运行定向测试、全量测试和 diff 空白检查。

## 实际结果

- `npm run build`：通过。
- `node --test dist/tests/unit/cli-entry.test.js dist/tests/unit/serve-wizard.test.js`：7 passed。
- `npm test`：141 passed，0 failed。
- `git diff --check`：通过。

关键断言：

- `cli:weixin:codex` 仍执行 `node dist/src/cli.js weixin codex`。
- CLI help 中 `weixin codex` 描述为“启动微信渠道管理向导”。
- CLI help 中保留 `weixin codex-direct`，并标注“旧版微信直连入口”。
- help 中不再把 `weixin codex` 描述为旧版真实微信直连启动。

## 结论

通过。

这次修复后，用户执行 `npm run cli:weixin:codex` 会进入新渠道管理向导，不会再首先要求选择 Codex session。需要旧版行为时可使用 `npm run cli:weixin:codex:direct`。

## 遗留问题

- 未在真实微信扫码环境下跑完整向导；当前通过 CLI help、脚本路由和现有 serve wizard 自动化测试覆盖入口语义。
