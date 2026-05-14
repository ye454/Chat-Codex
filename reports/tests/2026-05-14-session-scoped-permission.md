# 2026-05-14 session 级权限模式测试报告

## 变更目的

确认并修复 `/use` 或 `/resume` 绑定会话后，`/permission` 应只影响当前绑定 Codex session 的权限模式，而不是改掉整个 Codex adapter 的全局权限。

## 覆盖内容

- Bridge 在处理 `/permission` 和 `/status` 时把当前 route 绑定的 `sessionId` 传给 Codex adapter。
- `AppServerCodexAdapter` 为每个 session 保存独立 run policy；`turn/start` 使用当前 session 的 policy。
- `ExecCodexAdapter` 同步保存 session 级 run policy；exec fallback 的启动参数使用当前 session 的 policy。
- 没有绑定 session 时，`/permission` 才修改后续新会话默认权限。
- `/permission` 输出增加作用范围，区分“当前会话”和“默认策略”。
- mock adapter 同步支持 session-scoped policy，便于集成测试覆盖。
- 文档补充 `/permission` 的作用范围说明。

## 执行命令

```bash
npm run build
node --test --test-timeout=5000 dist/tests/integration/bridge-mock.test.js
node --test --test-timeout=5000 dist/tests/unit/app-server-codex-adapter.test.js dist/tests/unit/exec-codex-adapter.test.js
npm test
git diff --check
```

## 结果

- TypeScript build 通过。
- Bridge mock 针对性集成测试 16 个通过。
- app-server adapter 针对性单测 11 个通过。
- app-server adapter + exec adapter + Bridge mock 针对性测试 36 个通过。
- 全量测试 77 个通过。
- `git diff --check` 通过。
