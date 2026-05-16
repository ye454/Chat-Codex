import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CHAT_CODEX_UPLOAD_DIR_ENV,
  detectMimeType,
  extensionForInboundMedia,
  resolveInboundMediaUploadRoot,
  routeHash,
  sanitizePathPart,
  saveInboundMedia,
} from "../../src/bridge/inbound-media-store.js";
import type { ChannelAttachment, ChannelMessage } from "../../src/protocol/channel.js";

test("resolveInboundMediaUploadRoot defaults to user upload directory", () => {
  const startCwd = path.join(os.tmpdir(), "chat-codex-start");
  const homeDir = path.join(os.tmpdir(), "chat-codex-home");
  assert.equal(resolveInboundMediaUploadRoot({ startCwd, env: {}, homeDir }), path.join(homeDir, ".chat-codex", "uploads"));
});

test("resolveInboundMediaUploadRoot supports env override", () => {
  const startCwd = path.join(os.tmpdir(), "chat-codex-start");
  const absolute = path.join(os.tmpdir(), "chat-codex-uploads-absolute");
  assert.equal(
    resolveInboundMediaUploadRoot({ startCwd, env: { [CHAT_CODEX_UPLOAD_DIR_ENV]: absolute } }),
    absolute,
  );
  assert.equal(
    resolveInboundMediaUploadRoot({ startCwd, env: { [CHAT_CODEX_UPLOAD_DIR_ENV]: "relative-uploads" } }),
    path.join(startCwd, "relative-uploads"),
  );
});

test("saveInboundMedia writes a sanitized route-scoped file", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chat-codex-media-store-"));
  const message = mockMessage();
  const attachment: ChannelAttachment = {
    id: "../image#1",
    type: "image",
    name: "screen shot.png",
    mimeType: "image/png",
  };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  const saved = await saveInboundMedia({
    rootDir: root,
    message,
    attachment,
    data: png,
    now: new Date("2026-05-16T00:00:00.000Z"),
  });

  assert.equal(saved.mimeType, "image/png");
  assert.equal(saved.sizeBytes, png.byteLength);
  assert.equal(fs.existsSync(saved.localPath), true);
  assert.equal(saved.localPath.startsWith(root), true);
  assert.ok(saved.relativePath.includes(path.join("mock", "mock-account", routeHash(message.routeKey), "2026-05")));
  assert.ok(saved.relativePath.endsWith("mock-in-1-image_1.png"));
});

test("inbound media helpers detect MIME and sanitize path parts", () => {
  assert.equal(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(extensionForInboundMedia({ mimeType: "image/webp" }), ".webp");
  assert.equal(extensionForInboundMedia({ name: "report.final.PDF", fallbackType: "file" }), ".pdf");
  assert.equal(sanitizePathPart("../a b/c:d"), "a_b_c_d");
});

function mockMessage(): ChannelMessage {
  return {
    id: "mock-in-1",
    routeKey: "mock:mock-account:direct:user-1",
    channelId: "mock",
    accountId: "mock-account",
    sender: { id: "user-1" },
    conversation: { id: "user-1", kind: "direct" },
    timestamp: "2026-05-16T00:00:00.000Z",
  };
}
