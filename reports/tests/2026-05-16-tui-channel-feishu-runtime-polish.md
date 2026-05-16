# 测试报告：TUI 渠道管理、飞书添加和启动运行态提示

## 测试目标

验证 `chat-codex` TUI 按设计补齐以下交互：

1. 运行期日志面板不再提示未验证的 `q` / `Esc` 停止，明确提示 `Ctrl+C 停止服务`。
2. 运行期 TUI 收到 `SIGINT` / `SIGTERM` 后退出日志面板，让上层 `finally` 停止 Bridge。
3. 管理渠道页在正文中显示“添加微信账号”“添加飞书机器人”等操作项，不能只依赖 footer 快捷键。
4. 已有渠道存在时，仍能通过方向键和回车添加更多微信账号或飞书机器人。
5. 飞书添加流程不再要求普通用户输入飞书域，默认使用 `feishu`。
6. 飞书账号标识必填，用作本地可辨认的机器人名称。
7. 飞书提交后通过 adapter probe 校验机器人连通性，失败不登记为可启动渠道。
8. 首页将“启动服务”作为强主操作展示，可启动时默认选中并明确说明会进入运行中面板。
9. 运行期日志页第一屏明确展示 `Chat Codex 已启动`。
10. 聊天绑定详情不提供修改已有 session 工作目录；换工作目录需新建 session 再绑定。

## 测试环境

- 日期：2026-05-16
- 分支：main
- 操作系统：macOS
- Node.js：项目要求 Node.js >= 22

## 执行命令

```bash
npm run build
node --test dist/tests/unit/ink-tui.test.js dist/tests/unit/launcher-actions.test.js dist/tests/unit/channel-actions.test.js
npm test
```

## 覆盖用例

- `ChannelActions` 文本菜单展示数字操作项：`添加微信账号` / `添加飞书机器人`。
- Ink TUI 管理渠道页在已有渠道时展示正文操作项，并可用方向键 + Enter 进入添加飞书流程。
- Ink TUI 首页展示独立“启动服务”区，说明按 Enter 启动 Bridge 并进入运行日志面板。
- Ink TUI 飞书表单要求账号标识；为空时不调用添加 action。
- Ink TUI 飞书表单提交时自动带上默认 `domain: "feishu"`。
- `LauncherActions.addFeishuBot()` 在缺少账号标识时直接返回可恢复错误，不进入探测。
- 启动确认页说明启动后进入 `Chat Codex 运行中` 面板。
- 运行期日志面板展示 `Chat Codex 已启动`。
- 运行期日志面板展示 `Ctrl+C 停止服务`，不再展示 `q/Esc 停止`。
- `runRuntimeLogTui()` 收到 `SIGINT` 后 unmount 并返回。
- 设计文档明确已有 session 工作目录只展示，不支持直接修改，也不支持一个 session 多工作目录。

## 实际结果

- 相关单测通过：13 passed，0 failed。
- `npm test` 通过：208 passed，0 failed。

## 结论

通过。

## 备注

- 本次未使用真实飞书 App ID / App Secret 做人工连通性验证；代码路径已改为 `probeOnStart: true`，真实凭证下会通过 Feishu adapter 探测机器人身份。
- `q` / `Esc` 运行期停止没有继续宣传；后续如果要恢复，需要先做真实终端验证和测试记录。
