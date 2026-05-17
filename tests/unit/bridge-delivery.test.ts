import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "../../src/approvals/approval-manager.js";
import { BridgeDelivery } from "../../src/bridge/delivery.js";
import { BRIDGE_SEND_FILE_PREFIX } from "../../src/bridge/media-extractor.js";
import { SilentLogger } from "../../src/logging/logger.js";
import type { ChannelRegistry } from "../../src/channels/registry.js";
import type { ChannelMedia, ChannelTarget } from "../../src/protocol/channel.js";

test("BridgeDelivery swallows normal text send failures", async () => {
  const fixture = deliveryFixture({ failText: true });
  await fixture.delivery.sendText(target(), "hello");
  assert.equal(fixture.textAttempts, 1);
  assert.deepEqual(fixture.sentTexts, []);
});

test("BridgeDelivery suppresses progress briefly after a progress send failure", async () => {
  const fixture = deliveryFixture({ failText: true });
  await fixture.delivery.sendProgressText("route", target(), "progress 1");
  await fixture.delivery.sendProgressText("route", target(), "progress 2");
  assert.equal(fixture.textAttempts, 1);
  assert.deepEqual(fixture.sentTexts, []);
});

test("BridgeDelivery sends requested files through channel media", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-delivery-test-"));
  const filePath = path.join(root, "result.txt");
  fs.writeFileSync(filePath, "ok");
  const fixture = deliveryFixture({ media: true });

  await fixture.delivery.sendRequestedFiles(target(), `${BRIDGE_SEND_FILE_PREFIX} ${filePath}`, root);

  assert.equal(fixture.sentMedia.length, 1);
  assert.equal(fixture.sentMedia[0]?.path, filePath);
});

test("BridgeDelivery toggles typing around an operation", async () => {
  const fixture = deliveryFixture({ typing: true });
  await fixture.delivery.withTyping(target(), async () => {
    fixture.events.push("operation");
  });
  assert.deepEqual(fixture.typingEvents, [true, false]);
  assert.deepEqual(fixture.events, ["operation"]);
});

function deliveryFixture(options: { failText?: boolean; media?: boolean; typing?: boolean } = {}) {
  const sentTexts: string[] = [];
  const sentMedia: ChannelMedia[] = [];
  const typingEvents: boolean[] = [];
  const events: string[] = [];
  let textAttempts = 0;
  const channels = {
    sendText: async (_target: ChannelTarget, text: string) => {
      textAttempts += 1;
      if (options.failText) throw new Error("send failed");
      sentTexts.push(text);
      return { channelId: "mock", messageId: `text-${sentTexts.length}`, deliveredAt: new Date().toISOString() };
    },
    sendMedia: async (_target: ChannelTarget, media: ChannelMedia) => {
      sentMedia.push(media);
      return { channelId: "mock", messageId: `media-${sentMedia.length}`, deliveredAt: new Date().toISOString() };
    },
    sendTyping: async (_target: ChannelTarget, typing: boolean) => {
      typingEvents.push(typing);
    },
    getCapabilities: () => ({
      text: true,
      media: options.media ?? false,
      typing: options.typing ?? false,
      direct: true,
      group: false,
      thread: false,
      login: "none" as const,
      messageUpdate: false,
      streamingHint: false,
    }),
  } as unknown as ChannelRegistry;
  const delivery = new BridgeDelivery({
    channels,
    approvals: new ApprovalManager(),
    logger: new SilentLogger(),
    approvalSendRetryDelayMs: 1,
  });
  return {
    delivery,
    sentTexts,
    sentMedia,
    typingEvents,
    events,
    get textAttempts() {
      return textAttempts;
    },
  };
}

function target(): ChannelTarget {
  return {
    channelId: "mock",
    routeKey: "route",
    conversation: { id: "user", kind: "direct" },
    recipient: { id: "user" },
  };
}
