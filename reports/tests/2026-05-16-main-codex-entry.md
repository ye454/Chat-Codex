# 主启动入口交互测试报告

日期：2026-05-16

## 背景

已有 `cli:weixin:codex`、`cli:feishu:codex` 等渠道快捷入口，但日常使用需要一个不带具体渠道名的主启动入口，直接进入交互配置并启动。

## 修改范围

- 新增 npm scripts：
  - `npm run codex`
  - `npm run cli:codex`
- 新增 CLI 顶层命令：
  - `codex-wechat-bridge codex`
- 保留渠道快捷入口：
  - `npm run cli:weixin:codex`
  - `npm run cli:feishu:codex`
- `codex test` 保持原 mock 演示语义。
- README 和多渠道设计文档补充主入口说明。

## 自动化验证

### 单元测试

```bash
npm run test:unit
```

结果：

```text
97 passed, 0 failed
```

### 全量测试

```bash
npm test
```

结果：

```text
163 passed, 0 failed
```

### 格式检查

```bash
git diff --check
```

结果：通过。
