# 2026-05-16 微信扫码登录可返回流程测试

## 变更范围

- 添加微信账号时，二维码显示后不再直接长时间等待登录。
- 新增扫码检查菜单：
  - 回车：检查登录结果。
  - `0`：返回管理渠道。
- 单次检查使用短等待，未扫码时会提示继续检查或返回。
- 微信登录状态轮询现在会按传入的等待时间限制请求，避免短等待仍被长轮询卡住。

## 验证命令

```bash
npm run build
node --test dist/tests/integration/weixin-adapter-api.test.js
npm test
git diff --check
```

## 验证结果

- `npm run build`：通过。
- `node --test dist/tests/integration/weixin-adapter-api.test.js`：通过。
- `npm test`：184 passed，0 failed。
- `git diff --check`：通过。
- 旧飞书添加菜单文案和真实密钥扫描：无命中。
