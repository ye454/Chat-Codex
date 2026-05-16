# 测试报告：chat-codex 启动入口

## 测试目标

验证对外启动命令从容易和官方 Codex CLI 混淆的 `codex` npm script，调整为独立的 `chat-codex`：

- package 名称改为 `chat-codex`。
- npm bin 暴露 `chat-codex`。
- `npm run chat-codex` 作为推荐主入口。
- CLI help 只推荐 `chat-codex` 主命令。
- 旧 `codex` / `cli:codex` npm scripts 不再保留。

## 测试环境

- 日期：2026-05-16
- 分支：main
- Node.js：由本机 `npm` 测试环境提供
- 渠道：mock / fake Feishu / fake Weixin API

## 执行命令

```bash
npm run test:unit
npm test
git diff --check
rg -n "npm run codex|npm run cli:codex|codex-wechat-bridge codex|Codex Weixin Middleware|chat-codex codex test" README.md docs src tests package.json package-lock.json
```

## 测试步骤

1. 检查 `package.json` 和 `package-lock.json` 的包名与 bin 配置。
2. 检查 CLI help 是否展示 `chat-codex` 主入口。
3. 检查 README 和设计文档是否改为推荐 `npm run chat-codex`。
4. 跑单元测试和全量测试。
5. 检查 diff 空白问题和旧入口文案残留。

## 实际结果

### 单元测试

```text
npm run test:unit
102 passed, 0 failed
```

新增/更新覆盖：

- `package exposes chat-codex as the main startup command`
- `CLI help documents the chat-codex main entry`

### 全量测试

```text
npm test
169 passed, 0 failed
```

### 格式和残留检查

```text
git diff --check
```

通过。

旧主入口文案扫描无业务文档残留；仅测试中保留 `codex-wechat-bridge codex` 的反向断言。

## 结论

通过。`chat-codex` 已成为 package 名称、全局 bin 名称和推荐 npm script；旧 `codex` / `cli:codex` npm scripts 已移除。

## 遗留问题

- `codex-wechat-bridge` bin 暂时保留为兼容别名，后续正式发包前可以决定是否移除。
- 当前 `chat-codex` 主入口仍先进入微信向导，完整统一主控台还需要后续重构。
