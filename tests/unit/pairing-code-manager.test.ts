import test from "node:test";
import assert from "node:assert/strict";
import {
  PairingCodeManager,
  generatePairingCode,
  normalizePairingCode,
  parsePairingCodeInput,
} from "../../src/bridge/pairing-code-manager.js";

test("PairingCodeManager generates and normalizes readable pairing codes", () => {
  assert.match(generatePairingCode(), /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  assert.equal(normalizePairingCode(" abc-123 "), "ABC123");
  assert.equal(normalizePairingCode("abc 123"), "ABC123");
});

test("parsePairingCodeInput accepts /pair command and pure code input only", () => {
  assert.equal(parsePairingCodeInput("/pair ABC-123"), "ABC-123");
  assert.equal(parsePairingCodeInput("/PAIR abc 123"), "abc 123");
  assert.equal(parsePairingCodeInput("ABC123"), "ABC123");
  assert.equal(parsePairingCodeInput("hello ABC-123"), undefined);
  assert.equal(parsePairingCodeInput("/pair"), undefined);
});

test("PairingCodeManager verifies a code once and consumes the challenge", () => {
  const manager = new PairingCodeManager({ codeGenerator: () => "ABC-123" });
  const challenge = manager.getOrCreate("feishu:default:direct:oc_user");

  assert.equal(challenge.code, "ABC-123");
  assert.deepEqual(manager.verify(challenge.routeKey, "abc123"), { ok: true, challenge });
  assert.deepEqual(manager.verify(challenge.routeKey, "ABC-123"), { ok: false, reason: "missing" });
});

test("PairingCodeManager expires challenges", () => {
  let now = 1000;
  const manager = new PairingCodeManager({
    ttlMs: 1000,
    now: () => now,
    codeGenerator: () => "ABC-123",
  });
  const challenge = manager.getOrCreate("route-a");
  now = 2000;

  const result = manager.verify("route-a", "ABC-123");

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "expired");
    assert.deepEqual(result.challenge, challenge);
  }
});

test("PairingCodeManager locks and clears a challenge after too many mismatches", () => {
  let nextCode = 0;
  const codes = ["ABC-123", "DEF-456"];
  const manager = new PairingCodeManager({
    maxAttempts: 2,
    codeGenerator: () => codes[nextCode++] ?? "GHI-789",
  });

  assert.equal(manager.getOrCreate("route-a").code, "ABC-123");
  assert.deepEqual(manager.verify("route-a", "BAD-001"), {
    ok: false,
    reason: "mismatch",
    challenge: {
      routeKey: "route-a",
      code: "ABC-123",
      createdAt: manager.list()[0].createdAt,
      expiresAt: manager.list()[0].expiresAt,
      attempts: 1,
      maxAttempts: 2,
    },
  });
  const locked = manager.verify("route-a", "BAD-002");
  assert.equal(locked.ok, false);
  if (!locked.ok) assert.equal(locked.reason, "locked");
  assert.equal(manager.getOrCreate("route-a").code, "DEF-456");
});
