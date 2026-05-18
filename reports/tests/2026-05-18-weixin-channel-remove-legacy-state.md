# 测试报告：删除微信渠道清理旧登录态

## 测试目标

验证 TUI/CLI 删除微信渠道后，不会因为旧版 `state/weixin` 登录态残留，在下次启动时又被自动迁移注册回来。

## 问题原因

微信扫码登录会在旧兼容路径写入一份账号登录态。启动 `chat-codex` 时，为兼容旧版本，会检测这份旧登录态并自动注册为 managed 微信渠道。

此前删除渠道只删除 managed channel 配置、managed stateDir 和 route/session 状态，没有删除旧兼容路径里的同账号登录态。结果是删除后重启，旧登录态又触发自动注册，表现为微信渠道“删了又回来”。

## 修复范围

- `FileWeixinAccountStore` 新增 `removeAccount(accountId)`。
- 删除时同时按原始账号 ID 和规范化账号 ID 匹配旧登录态，兼容 `wx.account` 与 `wx-account` 这类差异。
- `ChannelActions.removeChannel()` 删除微信渠道时同步清理旧登录态。
- `ChannelActions.ensureLegacyWeixinAccountRegistered()` 复用同一个可注入的 legacy 微信账号 store，方便测试并保持迁移路径一致。

## 已执行验证

```bash
npm run build
node --test dist/tests/unit/channel-actions.test.js dist/tests/unit/file-state-store.test.js dist/tests/unit/launcher-actions.test.js dist/tests/unit/ink-tui.test.js
npm test
git diff --check
```

## 关键验证点

- 旧登录态存在时，启动兼容逻辑仍能注册微信渠道。
- 删除该微信渠道后，managed channel 配置被移除。
- 删除该微信渠道后，旧 `state/weixin` 登录态被移除。
- 删除后再次执行旧登录态自动注册逻辑，不会重新创建微信渠道。
- 删除渠道不影响其他渠道配置和绑定清理语义。

## 实际结果

- 定向测试：35 passed，0 failed。
- 全量 `npm test`：340 passed，0 failed。
- `npm run build` 通过。
- `git diff --check` 通过。

## 结论

通过。微信渠道删除后会清理造成复活的旧登录态；用户侧已复活的渠道需要再删除一次，新代码会把旧登录态一并清掉。
