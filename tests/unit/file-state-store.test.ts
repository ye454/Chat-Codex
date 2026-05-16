import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileStateStore } from "../../src/state/file-state-store.js";
import { ChannelConfigStore } from "../../src/state/channel-config-store.js";
import type { ChannelMessage } from "../../src/protocol/channel.js";
import type { CodexSession } from "../../src/codex/types.js";
import type { BridgeConfigDocument, ChannelAccountCredentialsDocument, ChannelAccountDocument, PendingBindingsDocument, RoutesDocument, SessionOwnersDocument, SessionPoliciesDocument } from "../../src/state/persistent-state-types.js";
import { pendingBindingOwnerRouteKey } from "../../src/state/memory-state-store.js";

test("FileStateStore persists active route binding and session owner", () => {
  const rootDir = tempStateDir();
  const store = new FileStateStore({ rootDir });
  const message = feishuMessage("feishu-main:default:direct:oc_user");
  const session = codexSession("session_one");

  store.recordRouteMessage(message);
  store.bindSession(message.routeKey, session);

  const reloaded = new FileStateStore({ rootDir });
  assert.equal(reloaded.getBinding(message.routeKey)?.sessionId, "session_one");
  assert.equal(reloaded.getSessionOwner("session_one")?.ownerRouteKey, message.routeKey);

  const routes = readJson<RoutesDocument>(path.join(rootDir, "routes.json"));
  assert.equal(routes.routes[0].routeKey, message.routeKey);
  assert.equal(routes.routes[0].conversationId, "oc_user");
  assert.equal(routes.routes[0].activeSessionId, "session_one");
  assert.equal(routes.routes[0].identity?.openId, "ou_user");
  assert.equal(routes.routes[0].identity?.tenantKey, "tenant_a");

  const owners = readJson<SessionOwnersDocument>(path.join(rootDir, "session-owners.json"));
  assert.deepEqual(owners.owners.map((owner) => [owner.sessionId, owner.ownerRouteKey]), [["session_one", message.routeKey]]);
});

test("FileStateStore keeps session owner global across routes after reload", () => {
  const rootDir = tempStateDir();
  const firstRoute = "feishu-main:default:direct:oc_user_a";
  const secondRoute = "weixin-main:wx:direct:wx_user_b";
  const store = new FileStateStore({ rootDir });
  store.recordRouteMessage(feishuMessage(firstRoute));
  store.bindSession(firstRoute, codexSession("session_shared"));

  const reloaded = new FileStateStore({ rootDir });
  const conflict = reloaded.claimSessionOwner(secondRoute, "session_shared");

  assert.equal(conflict.ok, false);
  if (!conflict.ok) {
    assert.equal(conflict.reason, "owned_by_other_route");
    assert.equal(conflict.owner.ownerRouteKey, firstRoute);
  }
});

test("FileStateStore persists session run policy", () => {
  const rootDir = tempStateDir();
  const store = new FileStateStore({ rootDir });

  store.setSessionRunPolicy("session_policy", { permissionMode: "full" });

  const reloaded = new FileStateStore({ rootDir });
  assert.equal(reloaded.getSessionRunPolicy("session_policy")?.permissionMode, "full");
  const policies = readJson<SessionPoliciesDocument>(path.join(rootDir, "session-policies.json"));
  assert.deepEqual(policies.policies.map((policy) => [policy.sessionId, policy.runPolicy.permissionMode]), [["session_policy", "full"]]);
});

test("FileStateStore persists route unbind and releases owner", () => {
  const rootDir = tempStateDir();
  const routeKey = "feishu-main:default:direct:oc_user";
  const store = new FileStateStore({ rootDir });
  store.recordRouteMessage(feishuMessage(routeKey));
  store.bindSession(routeKey, codexSession("session_unbind"));

  const result = store.unbindSession(routeKey);

  assert.equal(result.ok, true);
  const reloaded = new FileStateStore({ rootDir });
  assert.equal(reloaded.getBinding(routeKey), undefined);
  assert.equal(reloaded.getSessionOwner("session_unbind"), undefined);
  const routes = readJson<RoutesDocument>(path.join(rootDir, "routes.json"));
  assert.equal(routes.routes[0].activeSessionId, undefined);
});

test("FileStateStore persists pending bindings and reserves existing sessions", () => {
  const rootDir = tempStateDir();
  const store = new FileStateStore({ rootDir });

  store.setPendingBinding({
    id: "weixin-primary-weixin-wx-account",
    channelId: "weixin-wx-account",
    accountId: "wx-account",
    conversationKind: "direct",
    label: "微信 / wx-account / 主聊天",
    binding: { type: "existing", sessionId: "session_pending" },
  });

  const reloaded = new FileStateStore({ rootDir });
  assert.equal(reloaded.listPendingBindings()[0].binding.type, "existing");
  assert.equal(reloaded.getSessionOwner("session_pending")?.ownerRouteKey, pendingBindingOwnerRouteKey("weixin-primary-weixin-wx-account"));

  const conflict = reloaded.claimSessionOwner("feishu-main:default:direct:oc_user", "session_pending");
  assert.equal(conflict.ok, false);

  const pending = readJson<PendingBindingsDocument>(path.join(rootDir, "pending-bindings.json"));
  assert.equal(pending.pending[0].label, "微信 / wx-account / 主聊天");
});

test("ChannelConfigStore writes channel account metadata separately from local credentials", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-channel-config-"));
  const rootDir = path.join(baseDir, "state", "bridge");
  const store = new ChannelConfigStore({ bridgeDir: rootDir });

  store.upsertChannelInstance({
    id: "feishu-main",
    type: "feishu",
    accountId: "default",
    credentialSource: "env",
    metadata: {
      appId: "cli_xxx...abcd",
      domain: "feishu",
    },
  });
  store.upsertChannelInstance({
    id: "weixin-main",
    type: "weixin",
    accountId: "wx-account",
    credentialSource: "state",
  });

  const config = readJson<BridgeConfigDocument>(path.join(rootDir, "config.json"));
  assert.deepEqual(config.channels.map((channel) => [channel.id, channel.type, channel.defaultAccountId]), [
    ["feishu-main", "feishu", "default"],
    ["weixin-main", "weixin", "wx-account"],
  ]);

  const feishuAccountPath = path.join(baseDir, "state", "channels", "feishu", "feishu-main", "accounts", "default", "account.json");
  const weixinAccountPath = path.join(baseDir, "state", "channels", "weixin", "weixin-main", "accounts", "wx-account", "account.json");
  const feishuAccount = readJson<ChannelAccountDocument>(feishuAccountPath);
  assert.equal(feishuAccount.channelType, "feishu");
  assert.equal(feishuAccount.metadata?.appId, "cli_xxx...abcd");
  assert.equal(fs.readFileSync(feishuAccountPath, "utf-8").includes("secret"), false);
  assert.equal(fs.existsSync(weixinAccountPath), true);

  const record = config.channels.find((channel) => channel.id === "feishu-main");
  assert.ok(record);
  store.writeAccountCredentials(record, "default", {
    appId: "cli_real_app",
    appSecret: "real-secret",
    domain: "feishu",
  });
  const credentialsPath = path.join(baseDir, "state", "channels", "feishu", "feishu-main", "accounts", "default", "credentials.local.json");
  const credentials = readJson<ChannelAccountCredentialsDocument>(credentialsPath);
  assert.equal(credentials.credentials.appId, "cli_real_app");
  assert.equal(credentials.credentials.appSecret, "real-secret");
  assert.deepEqual(store.readAccountCredentials(record, "default"), {
    appId: "cli_real_app",
    appSecret: "real-secret",
    domain: "feishu",
  });
});

function tempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codex-bridge-state-"));
}

function codexSession(id: string): CodexSession {
  return {
    id,
    cwd: "/tmp/work",
    title: `Session ${id}`,
    createdAt: new Date().toISOString(),
  };
}

function feishuMessage(routeKey: string): ChannelMessage {
  return {
    id: "om_message",
    routeKey,
    channelId: "feishu-main",
    accountId: "default",
    sender: { id: "ou_user", displayName: "飞书用户" },
    conversation: { id: "oc_user", kind: "direct", displayName: "飞书私聊" },
    text: "你好",
    timestamp: "2026-05-16T00:00:00.000Z",
    raw: {
      tenant_key: "tenant_a",
      sender: {
        sender_id: {
          open_id: "ou_user",
          user_id: "user_a",
          union_id: "union_a",
        },
        sender_type: "user",
        tenant_key: "tenant_a",
      },
      message: {
        message_id: "om_message",
        chat_id: "oc_user",
      },
    },
  };
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}
