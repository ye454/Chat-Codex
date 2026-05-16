# 2026-05-16 飞书机器人添加交互改造测试

## 变更范围

- `添加飞书机器人` 不再展示旧的凭证来源二选一菜单。
- 交互入口直接提示手动输入 App ID / App Secret。
- 环境变量读取能力保留给状态检查、非交互启动和重启后的运行时凭证来源。
- 手动输入的飞书凭证只缓存在当前进程内存中，不写入状态文件或仓库文件。

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
