# 2026-05-16 CLI 列表页操作快捷键测试

## 变更范围

- 有对象列表的页面，数字只用于选择对象。
- 同屏操作改为字母快捷键：
  - `w` 添加微信账号。
  - `f` 添加飞书机器人。
  - `n` 新建 Codex session。
  - `m` 手动输入 Session ID。
- 首页渠道摘要不再使用数字编号，避免和首页操作编号混淆。
- 普通纯动作菜单仍保留数字选择。

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
- 旧飞书添加菜单文案和真实密钥扫描：无命中。
