import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalManager } from "../../src/approvals/approval-manager.js";
import { BridgeDelivery } from "../../src/bridge/delivery.js";
import { BridgeRouteSteering } from "../../src/bridge/route-steering.js";
import { MockCodexAdapter } from "../../src/codex/mock-codex-adapter.js";
import { codexInputPlainText } from "../../src/codex/input.js";
import type { CodexPromptInput, CodexSessionStatus } from "../../src/codex/types.js";
import { SilentLogger } from "../../src/logging/logger.js";
import type { ChannelRegistry } from "../../src/channels/registry.js";
import type { ChannelMessage, ChannelTarget } from "../../src/protocol/channel.js";
import { MemoryStateStore } from "../../src/state/memory-state-store.js";

test("BridgeRouteSteering batches steer messages and acknowledges delivery", async () => {
  const fixture = await steeringFixture();
  assert.equal(await fixture.steering.tryEnqueue(message("补充 A"), target(), "补充 A"), true);
  assert.equal(await fixture.steering.tryEnqueue(message("补充 B"), target(), "补充 B"), true);

  await waitFor(() => fixture.codex.steers.length === 1);

  assert.match(fixture.codex.steers[0] ?? "", /用户补充消息 1:\n补充 A/);
  assert.match(fixture.codex.steers[0] ?? "", /用户补充消息 2:\n补充 B/);
  assert.match(fixture.sentTexts.at(-1) ?? "", /已投递 2 条补充消息/);
});

test("BridgeRouteSteering falls back to prompt queue when steer is rejected", async () => {
  const fixture = await steeringFixture({ failSteer: true });
  await fixture.steering.tryEnqueue(message("补充"), target(), "补充");

  await waitFor(() => fixture.fallbackInputs.length === 1);

  assert.equal(fixture.codex.steers.length, 0);
  assert.equal(codexInputPlainText(fixture.fallbackInputs[0]?.input ?? ""), "补充");
});

async function steeringFixture(options: { failSteer?: boolean } = {}) {
  const routeKey = "mock:default:direct:user";
  const codex = new SteeringCodexAdapter(options.failSteer ?? false);
  const state = new MemoryStateStore();
  const session = await codex.startSession({ routeKey, cwd: "/repo", title: "test" });
  state.bindSession(routeKey, session);
  const sentTexts: string[] = [];
  const delivery = new BridgeDelivery({
    channels: {
      sendText: async (_target: ChannelTarget, text: string) => {
        sentTexts.push(text);
        return { channelId: "mock", messageId: `m-${sentTexts.length}`, deliveredAt: new Date().toISOString() };
      },
    } as unknown as ChannelRegistry,
    approvals: new ApprovalManager(),
    logger: new SilentLogger(),
    approvalSendRetryDelayMs: 1,
  });
  const fallbackInputs: Array<{ input: CodexPromptInput }> = [];
  const steering = new BridgeRouteSteering({
    codex,
    state,
    logger: new SilentLogger(),
    delivery,
    debounceMs: 1,
    batchMaxMessages: 5,
    batchMaxChars: 4000,
    isRouteBusy: () => true,
    enqueuePromptFallback: async (items) => {
      fallbackInputs.push(...items.map((item) => ({ input: item.input })));
    },
  });
  return { codex, steering, sentTexts, fallbackInputs };
}

class SteeringCodexAdapter extends MockCodexAdapter {
  readonly steers: string[] = [];

  constructor(private readonly failSteer: boolean) {
    super();
  }

  override async getStatus(sessionId: string): Promise<CodexSessionStatus> {
    const status = await super.getStatus(sessionId);
    return { ...status, type: "running", turnId: "turn-1" };
  }

  async steer(_sessionId: string, prompt: CodexPromptInput): Promise<void> {
    if (this.failSteer) throw new Error("steer rejected");
    this.steers.push(codexInputPlainText(prompt));
  }
}

function message(text: string): ChannelMessage {
  return {
    id: `message-${text}`,
    routeKey: "mock:default:direct:user",
    channelId: "mock",
    sender: { id: "user" },
    conversation: { id: "user", kind: "direct" },
    text,
    timestamp: new Date().toISOString(),
  };
}

function target(): ChannelTarget {
  return {
    channelId: "mock",
    routeKey: "mock:default:direct:user",
    conversation: { id: "user", kind: "direct" },
    recipient: { id: "user" },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}
