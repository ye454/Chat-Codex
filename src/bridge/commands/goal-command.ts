import type { CodexAdapter, CodexGoal, CodexGoalStatus } from "../../codex/types.js";
import type { ChannelMessage, ChannelTarget } from "../../protocol/channel.js";
import type { MemoryStateStore } from "../../state/memory-state-store.js";
import type { BridgeDelivery } from "../delivery.js";
import type { BridgeSessionFlow } from "../session-flow.js";
import {
  commandBody,
  formatDuration,
  formatGoalStatus,
  formatNumber,
  goalErrorText,
} from "../formatters.js";

export interface GoalCommandOptions {
  codex: CodexAdapter;
  state: MemoryStateStore;
  delivery: BridgeDelivery;
  sessionFlow: BridgeSessionFlow;
}

export async function handleGoalCommand(
  options: GoalCommandOptions,
  message: ChannelMessage,
  target: ChannelTarget,
  rawText: string,
): Promise<void> {
  if (!options.codex.getGoal || !options.codex.setGoal || !options.codex.setGoalStatus || !options.codex.clearGoal) {
    await options.delivery.sendText(target, "当前 Codex Adapter 不支持 Goal。请使用 app-server adapter，并确认 Codex 已启用 features.goals。");
    return;
  }
  const body = commandBody(rawText, "goal");
  const action = body.toLowerCase();
  const binding = options.state.getBinding(message.routeKey);
  try {
    if (!body) {
      if (!binding) {
        await options.delivery.sendText(target, [
          "**Goal**",
          "- 当前没有绑定 Codex 会话，也没有 Goal。",
          "- 发送 `/goal <目标>` 可为当前微信上下文创建/绑定会话并设置长期目标。",
        ].join("\n"));
        return;
      }
      await options.delivery.sendText(target, goalText(await options.codex.getGoal(binding.sessionId)));
      return;
    }
    if (action === "clear") {
      if (!binding) {
        await options.delivery.sendText(target, "当前没有绑定 Codex 会话，也没有可清除的 Goal。");
        return;
      }
      const cleared = await options.codex.clearGoal(binding.sessionId);
      await options.delivery.sendText(target, cleared ? "已清除 Goal。后续任务不再按该长期目标追踪。" : "当前会话没有 Goal。");
      return;
    }
    if (action === "pause" || action === "resume") {
      if (!binding) {
        await options.delivery.sendText(target, "当前没有绑定 Codex 会话，也没有可暂停/恢复的 Goal。");
        return;
      }
      const status: CodexGoalStatus = action === "pause" ? "paused" : "active";
      const goal = await options.codex.setGoalStatus(binding.sessionId, status);
      await options.delivery.sendText(target, goalText(goal, action === "pause" ? "已暂停 Goal。" : "已恢复 Goal。"));
      return;
    }
    const session = await options.sessionFlow.ensureSession(message);
    const goal = await options.codex.setGoal(session.id, body);
    await options.delivery.sendText(target, goalText(goal, "已设置 Goal。"));
  } catch (error) {
    await options.delivery.sendText(target, goalErrorText(error));
  }
}

export function goalText(goal: CodexGoal | null, title = "**Goal**"): string {
  if (!goal) {
    return [
      title,
      "- 当前没有 Goal。",
      "- 发送 `/goal <目标>` 设置长期目标。",
    ].join("\n");
  }
  return [
    title,
    `- Objective: ${goal.objective}`,
    `- Status: \`${formatGoalStatus(goal.status)}\``,
    goal.tokenBudget !== null ? `- Token budget: \`${formatNumber(goal.tokenBudget)}\`` : undefined,
    `- Tokens used: \`${formatNumber(goal.tokensUsed)}\``,
    `- Time used: \`${formatDuration(goal.timeUsedSeconds)}\``,
    "",
    "命令说明：",
    "- `/goal pause`：暂停追踪，保留目标但暂时不让 Codex 按它推进。",
    "- `/goal resume`：恢复追踪，让 Codex 继续按该目标推进。",
    "- `/goal clear`：清除目标，也就是退出当前 Goal 追踪。",
  ].filter(Boolean).join("\n");
}
