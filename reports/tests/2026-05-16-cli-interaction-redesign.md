# CLI 交互重构测试报告

## 范围

- `weixin codex` / `serve` 启动交互改为首页模式：管理渠道、聊天绑定、Codex 默认设置、状态详情、启动服务。
- TUI 仅保留在设计文档，不实现全屏界面。
- 移除旧版 `weixin codex-direct` 入口和 npm script。
- 修复首个微信私聊预设绑定语义：使用 `initialRouteBinding`，并限制 pending 预设只归属第一个微信私聊 route。
- CLI 选择已有 session 时进入编号选择模式；错误编号或错误 ID 可重试或返回。

## 自动化验证

### `npm run test:unit`

- 结果：通过
- 统计：84 passed，0 failed
- 覆盖重点：
  - CLI help 不再暴露 `weixin codex-direct`
  - 向导首页和子页面中文文案
  - 首页操作顺序：渠道 -> 聊天绑定 -> Codex 默认设置 -> 状态详情 -> 启动服务
  - 子页面 `0 返回`
  - session 标题省略格式

### `npm run test:integration`

- 结果：通过
- 统计：64 passed，0 failed
- 覆盖重点：
  - `/resume` / `/use` 编号选择模式
  - 错误 session ID 转为可恢复选择提示
  - `/sessions all` 长标题省略
  - 首个 route 预设绑定不会被 `/new` 后的其他 route 误消费
  - `/status` 先到达时，pending 预设只归属该第一个私聊 route
  - `initialRouteBinding: { type: "new" }` 可绕过 ask 策略，只作用于第一个私聊 route

### `npm test`

- 结果：通过
- 统计：148 passed，0 failed

## 结论

本轮 CLI 交互重构和 pending 首个 route 绑定修复已通过单元测试与集成测试。
