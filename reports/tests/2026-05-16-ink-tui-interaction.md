# 测试报告：Ink TUI 交互

## 测试目标

验证 `chat-codex` TTY 默认 Ink TUI 的基础交互实现，包括首页、渠道页、聊天绑定页、权限页、TUI fallback 参数、TypeScript 构建和完整测试回归。

## 测试环境

- 日期：2026-05-16
- 分支/提交：main，本地未提交工作区
- Node.js 版本：项目要求 Node.js >= 22
- 操作系统：macOS
- Codex 版本：沿用本机 `checkCodexCli()` 检测
- 渠道：mock / 本地状态；未执行真实微信或飞书端到端

## 执行命令

```bash
npm install ink react @inkjs/ui ink-testing-library
npm install --save-dev @types/react
npm run build
node --test dist/tests/unit/ink-tui.test.js
npm test
npm audit --omit=dev
```

## 测试步骤

1. 安装 Ink、React、`@inkjs/ui`、`ink-testing-library` 和 React 类型声明。
2. 新增 `LauncherActions`，把 TUI 需要的 dashboard、渠道、绑定、权限、微信主聊天 pending binding、飞书机器人添加等操作作为结构化接口暴露。
3. 新增 Ink TUI shell，覆盖首页、管理渠道、添加微信、添加飞书、聊天绑定、绑定详情、Session 选择、手动 Session ID、权限设置、状态详情、启动确认和帮助页。
4. 接入 `runServe()`：TTY 且未传 `--no-tui` 时进入 Ink TUI；非 TTY、`--no-tui`、`--no-interactive` 保持 fallback 行为。
5. 新增 Ink TUI 单元测试，验证首页渲染、`c`、`b`、`p` 关键页面导航、pending 绑定展示、帮助页、飞书表单 Esc 返回和启动确认闭环。
6. 执行完整测试回归。
7. 执行 npm audit 只读检查。

## 实际结果

- `npm run build` 通过。
- `node --test dist/tests/unit/ink-tui.test.js` 通过。
- `npm test` 通过：186 passed，0 failed。
- `npm audit --omit=dev` 报告 2 个 high severity，来源为既有 `@larksuiteoapi/node-sdk -> axios`，审计输出显示 `No fix available`。本次未执行 `npm audit fix --force`，避免破坏性升级。

## 结论

通过。

## 遗留问题

- 本次未执行真实微信扫码和真实飞书机器人端到端验证；需要用户提供真实渠道环境后补测。
- 运行期 transcript 仍沿用现有 `ConsoleTranscriptSink`，运行期 TUI 面板属于后续增强项。
- npm audit 的 axios 风险来自飞书 SDK 依赖链，当前无直接修复版本，需要后续关注 SDK 更新或替代方案。
