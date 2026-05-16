import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelActions, feishuChannelId, formatManagedChannelList, weixinChannelId } from "../../src/cli/actions/channel-actions.js";
import { ChannelConfigStore } from "../../src/state/channel-config-store.js";
import type { StoredWeixinAccount } from "../../src/channels/weixin/weixin-account-store.js";

test("ChannelActions registers independent Weixin accounts and Feishu bots", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-channel-actions-"));
  const configStore = new ChannelConfigStore({ bridgeDir: path.join(baseDir, "state", "bridge") });
  const actions = new ChannelActions({
    configStore,
    env: {
      FEISHU_APP_ID: "cli_test_app",
      FEISHU_APP_SECRET: "test-secret",
      FEISHU_DOMAIN: "feishu",
    },
  });

  const weixinA = actions.registerWeixinAccount(weixinAccount("wx.account-a"));
  const weixinB = actions.registerWeixinAccount(weixinAccount("wx.account-b"));
  const feishuA = actions.registerFeishuBot({ appId: "cli_a", appSecret: "secret-a", accountId: "bot-a" });
  const feishuB = actions.registerFeishuBot({ appId: "cli_b", appSecret: "secret-b", accountId: "bot-b" });

  assert.equal(weixinA.id, weixinChannelId("wx-account-a"));
  assert.equal(weixinB.id, weixinChannelId("wx-account-b"));
  assert.equal(feishuA.id, feishuChannelId("bot-a"));
  assert.equal(feishuB.id, feishuChannelId("bot-b"));
  assert.deepEqual(actions.listChannelInstances().map((channel) => channel.id), [
    feishuA.id,
    feishuB.id,
    weixinA.id,
    weixinB.id,
  ]);

  actions.setChannelEnabled(feishuB.id, false);
  const runtimeAdapters = actions.createRuntimeAdapters();
  assert.deepEqual(runtimeAdapters.map((adapter) => adapter.id).sort(), [
    feishuA.id,
    weixinA.id,
    weixinB.id,
  ].sort());

  const summaries = await actions.listChannelSummaries();
  assert.equal(summaries.length, 4);
  assert.equal(summaries.find((channel) => channel.record.id === weixinA.id)?.status.state, "connected");
  assert.equal(summaries.find((channel) => channel.record.id === feishuA.id)?.status.state, "connected");
  assert.equal(summaries.find((channel) => channel.record.id === feishuB.id)?.record.enabled, false);
  const channelList = formatManagedChannelList(summaries);
  assert.match(channelList, /1\. 飞书 \/ bot-a/);
  assert.match(channelList, /5\. 添加微信账号/);
  assert.match(channelList, /6\. 添加飞书机器人/);
  assert.match(channelList, /w\. 添加微信账号/);
  assert.match(channelList, /f\. 添加飞书机器人/);

  const weixinAccountPath = path.join(baseDir, "state", "channels", "weixin", weixinA.id, "accounts", "wx-account-a.json");
  assert.equal(fs.existsSync(weixinAccountPath), true);
});

test("ChannelActions persists interactive Feishu credentials in local state", async () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-channel-actions-"));
  const bridgeDir = path.join(baseDir, "state", "bridge");
  const configStore = new ChannelConfigStore({ bridgeDir });
  const actions = new ChannelActions({ configStore, env: {} });

  const record = actions.registerFeishuBot({
    appId: "cli_interactive_app",
    appSecret: "interactive-secret",
    accountId: "bot-interactive",
  }, "state-local");

  const statusAdapter = actions.createStatusAdapter(record);
  await statusAdapter.start();
  assert.equal((await statusAdapter.getStatus()).state, "connected");

  const accountPath = path.join(baseDir, "state", "channels", "feishu", record.id, "accounts", "bot-interactive", "account.json");
  const persistedAccount = fs.readFileSync(accountPath, "utf8");
  assert.equal(persistedAccount.includes("interactive-secret"), false);
  assert.equal(persistedAccount.includes("cli_interactive_app"), false);
  const credentialsPath = path.join(baseDir, "state", "channels", "feishu", record.id, "accounts", "bot-interactive", "credentials.local.json");
  const persistedCredentials = fs.readFileSync(credentialsPath, "utf8");
  assert.equal(persistedCredentials.includes("interactive-secret"), true);
  assert.equal(persistedCredentials.includes("cli_interactive_app"), true);

  const restartedActions = new ChannelActions({
    configStore: new ChannelConfigStore({ bridgeDir }),
    env: {},
  });
  const restartedRecord = restartedActions.listChannelInstances()[0];
  assert.ok(restartedRecord);
  const restartedStatusAdapter = restartedActions.createStatusAdapter(restartedRecord);
  await restartedStatusAdapter.start();
  assert.equal((await restartedStatusAdapter.getStatus()).state, "connected");
});

function weixinAccount(accountId: string): StoredWeixinAccount {
  return {
    accountId,
    token: `token-${accountId}`,
    baseUrl: "https://weixin.example.test",
    savedAt: "2026-05-16T00:00:00.000Z",
  };
}
