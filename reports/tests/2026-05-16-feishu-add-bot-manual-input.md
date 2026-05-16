# 2026-05-16 飞书机器人添加交互改造测试

## 变更范围

- `添加飞书机器人` 不再展示旧的凭证来源二选一菜单。
- 交互入口直接提示手动输入 App ID / App Secret。
- 环境变量读取能力保留给状态检查和手动覆盖。
- 手动输入的飞书凭证会写入本机 `state/channels/feishu/<channelId>/accounts/<accountId>/credentials.local.json`，重启后自动读取；该路径被 `.gitignore` 忽略，不写入仓库文件。

## 验证命令

```bash
npm run build
npm run test:unit
npm test
git diff --check
```

## 验证结果

- `npm run build`：通过。
- `npm run test:unit`：114 passed，0 failed。
- `npm test`：183 passed，0 failed。
- `git diff --check`：通过。
- 旧交互菜单文案扫描：无命中。
- 真实飞书 App ID / App Secret 扫描：无命中。
