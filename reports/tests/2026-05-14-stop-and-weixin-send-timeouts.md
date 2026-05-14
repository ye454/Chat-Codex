# 2026-05-14 `/stop` 与微信发送超时修复测试报告

## 测试目标

- 验证 `/stop` 不再无限等待 app-server 的 `turn/interrupt` response。
- 验证服务关闭时不再把主动停止的 app-server 退出误报为 `Codex 执行失败`。
- 验证微信 `sendmessage`、`getuploadurl`、CDN 上传和远程媒体下载都带超时 signal。
- 验证文件或图片发送卡住时，Bridge 能收到失败并走媒体文本降级，而不是一直阻塞任务。

## 修复点

- `AppServerCodexAdapter.cancel()` 改为本地立即关闭 turn，再异步 best-effort 发送 `turn/interrupt`。
- `turn/interrupt` 增加 timeout，迟到或不返回都不会阻塞 `/stop` 命令。
- `AppServerCodexAdapter.stop()` 增加主动停止标记，避免 Ctrl+C/服务停止时把 app-server 正常退出推成 turn failed。
- Weixin 文本发送、媒体上传和 CDN 上传增加默认超时。

## 执行命令

```bash
npm run build
node --test --test-timeout=5000 dist/tests/unit/app-server-codex-adapter.test.js dist/tests/integration/weixin-adapter-api.test.js
npm test
git diff --check
```

## 结果

```text
npm run build: passed
targeted tests: 15 passed, 0 failed
npm test: 64 passed, 0 failed
git diff --check: passed
```

## 结论

这次 `/stop` 卡住的直接原因是 adapter 等待 `turn/interrupt` 的 JSON-RPC 响应；如果 app-server 或相关工具链当时不回包，微信命令也不会返回。修复后 `/stop` 是本地优先的逃生操作，不依赖 app-server 立即响应。

文件发送卡住的风险来自微信 CDN 上传或 sendmessage 没有统一超时。修复后这些网络调用都有 AbortSignal，超时会变成普通发送失败，Bridge 再降级成文本路径说明。
