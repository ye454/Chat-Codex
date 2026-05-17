# Bridge 模块化拆分测试报告

日期：2026-05-17

## 范围

本次按 `docs/bridge-modularization-design.zh-CN.md` 拆分 `src/bridge/bridge.ts`，目标是在保留现有全部功能的前提下，把单体 Bridge 拆成可单独测试和维护的小模块。

已完成：

- 按设计要求新增单体对照备份：`src/bridge/bridge.monolith.snapshot.ts.bak`。
- 新增 `src/bridge/bridge-types.ts`，承载 Bridge 共享类型和常量。
- 新增 `src/bridge/formatters.ts`，承载纯格式化、命令参数解析和小工具函数。
- 新增 `src/bridge/status-text.ts`，承载 `/status`、`/sessions`、`/whoami`、`/debug`、`/help` 等展示文案。
- 新增 `src/bridge/command-router.ts`，承载 slash command 分发、refresh command 和 route busy mutation guard。
- 新增 `src/bridge/commands/*`，承载审批、取消、协作模式、Goal、模型、权限、进度、sendfile 和 stop 命令语义。
- 新增 `src/bridge/delivery.ts`，承载文本发送、进度发送、审批重试、typing 和 `/sendfile` 文件投递。
- 新增 `src/bridge/session-flow.ts`，承载 session selection、新建 session、resume/use、owner claim、pending 初始绑定和 unbound route 策略。
- 新增 `src/bridge/route-queue.ts`，承载 route prompt 队列、worker、abort controller、turn 执行、排队提示和 sendfile 最终投递。
- 新增 `src/bridge/route-steering.ts`，承载执行中 steer、debounce、batch、fallback 和清理。
- 新增 `src/bridge/background-turns.ts`，承载 app-server background Goal 事件、进度和最终回复投递。

`src/bridge/bridge.ts` 从 2466 行降到 400 行。设计文档列出的目标模块已经全部拆出；当前没有剩余计划内模块未拆。

## 逐模块测试覆盖

| 模块 | 覆盖方式 |
| --- | --- |
| `bridge-types.ts` | `npm run build` 验证共享类型、常量和跨模块 import 编译通过。 |
| `formatters.ts` | `tests/unit/bridge-formatters.test.ts` 覆盖 progress mode 解析、model command 解析、route busy mutation guard、权限/model 文案、Goal 北京时间、session choice、steer batch 和模型引用解析。 |
| `status-text.ts` | `tests/integration/bridge-mock.test.ts` 覆盖 `/status`、`/sessions`、`/whoami`、`/debug`、`/help`、微信 progress disabled、飞书 progress mode、Goal 时间和权限/model 展示。 |
| `command-router.ts` | `tests/unit/bridge-command-router.test.ts` 覆盖 unknown command、refresh command、busy mutation guard、progress 正常分发和 progress disabled。 |
| `commands/*` | `tests/unit/bridge-command-router.test.ts` 覆盖命令分发入口；`tests/integration/bridge-mock.test.ts` 覆盖 approval、cancel、collaboration、goal、model、permission、progress、sendfile、stop 的聊天端集成路径。 |
| `delivery.ts` | `tests/unit/bridge-delivery.test.ts` 覆盖普通文本发送失败吞掉、progress 失败 cooldown、`BRIDGE_SEND_FILE` 文件投递、typing on/off；`bridge-mock` 继续覆盖 approval retry、sendfile 协议剥离和媒体失败聚合。 |
| `session-flow.ts` | `tests/unit/bridge-session-flow.test.ts` 覆盖新 session 使用启动 cwd、existing session 绑定、owner 冲突、初始绑定 route scope；`bridge-mock` 继续覆盖 session selection、resume/use、pending initial binding、ask policy 和跨 route owner 冲突。 |
| `route-queue.ts` | `tests/unit/bridge-route-queue.test.ts` 覆盖 prompt 入队、final reply、同 route 串行和清空队列；`bridge-mock` 继续覆盖 `/stop`、排队提示、sendfile final 投递、typing/progress、background turn 并存。 |
| `route-steering.ts` | `tests/unit/bridge-route-steering.test.ts` 覆盖 steer batch、确认文案和 steer rejected fallback；`bridge-mock` 继续覆盖 route scope、命令不进 steer、`/stop` 清理和图文 steer。 |
| `background-turns.ts` | `tests/integration/bridge-mock.test.ts` 覆盖 background Goal final 投递、progress suppress、typing 和 background turn 与普通 route queue 并存。 |
| `bridge.ts` | `tests/integration/bridge-mock.test.ts` 和全量 `npm test` 覆盖 start/stop、handleMessage 一级分流、普通消息/媒体消息/命令消息路由、waitForIdle 和跨模块集成行为。 |

## 执行命令

```bash
npm run build
node --test dist/tests/unit/bridge-command-router.test.js dist/tests/unit/bridge-session-flow.test.js dist/tests/unit/bridge-route-queue.test.js dist/tests/unit/bridge-formatters.test.js dist/tests/unit/bridge-delivery.test.js dist/tests/unit/bridge-route-steering.test.js
node --test dist/tests/integration/bridge-mock.test.js
npm test
git diff --check
git show HEAD:src/bridge/bridge.ts | cmp - src/bridge/bridge.monolith.snapshot.ts.bak
```

## 结果

```text
npm run build: passed
新增 Bridge 模块单元测试: 23 passed, 0 failed
bridge-mock 集成测试: 72 passed, 0 failed
npm test: 265 passed, 0 failed
备份一致性检查: passed
```

## 结论

本次拆分只改变模块边界，不改变外部交互语义。设计文档中列出的模块已经全部拆出，每个模块都有对应单元测试或明确的集成测试覆盖。

拆分后 `bridge.ts` 只保留 Bridge 装配、生命周期、一级消息分流、pending media 管理和少量跨模块状态协调；核心 session flow、route queue、命令、投递、status 文案、steering 和 background turn 逻辑已迁移到独立模块。
