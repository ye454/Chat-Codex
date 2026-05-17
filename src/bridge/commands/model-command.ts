import type { CodexAdapter, CodexModelOption, CodexModelPolicy } from "../../codex/types.js";
import type { ChannelMessage, ChannelTarget } from "../../protocol/channel.js";
import type { MemoryStateStore } from "../../state/memory-state-store.js";
import type { BridgeDelivery } from "../delivery.js";
import type { BridgeRouteQueue } from "../route-queue.js";
import type { BridgeStatusText } from "../status-text.js";
import {
  currentModelOption,
  formatModelScope,
  invalidReasoningEffortText,
  isModelAllToken,
  isModelListToken,
  modelSupportsEffort,
  parseModelCommandArgs,
  parseReasoningEffort,
  resolveModelReference,
  unsupportedReasoningEffortText,
} from "../formatters.js";

export interface ModelCommandOptions {
  codex: CodexAdapter;
  state: MemoryStateStore;
  delivery: BridgeDelivery;
  routeQueue: BridgeRouteQueue;
  statusText: BridgeStatusText;
}

export async function handleModelCommand(
  options: ModelCommandOptions,
  message: ChannelMessage,
  target: ChannelTarget,
  args: string[],
): Promise<void> {
  const listModels = options.codex.listModels?.bind(options.codex);
  const getModelPolicy = options.codex.getModelPolicy?.bind(options.codex);
  const setModelPolicy = options.codex.setModelPolicy?.bind(options.codex);
  if (!listModels || !getModelPolicy || !setModelPolicy) {
    await options.delivery.sendText(target, "当前 Codex Adapter 不支持模型列表或运行时模型切换。");
    return;
  }

  const includeHidden = args.some(isModelAllToken);
  const commandArgs = args.filter((arg) => !isModelAllToken(arg) && !isModelListToken(arg));
  const binding = options.state.getBinding(message.routeKey);
  const sessionId = binding?.sessionId;
  const parsed = parseModelCommandArgs(commandArgs);
  if (parsed.type === "error") {
    await options.delivery.sendText(target, parsed.message);
    return;
  }
  if (parsed.type === "reset") {
    setModelPolicy({}, sessionId);
    await options.delivery.sendText(target, [
      "已清除 Codex 模型覆盖。",
      `作用范围: ${formatModelScope(sessionId)}`,
      options.routeQueue.hasWorker(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
    ].filter(Boolean).join("\n"));
    return;
  }

  let models: CodexModelOption[];
  try {
    models = await listModels({ includeHidden });
  } catch (error) {
    await options.delivery.sendText(target, `获取 Codex 模型列表失败: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  const policy = getModelPolicy(sessionId);
  const status = binding ? await options.codex.getStatus(binding.sessionId).catch(() => undefined) : undefined;

  if (parsed.type === "list") {
    await options.delivery.sendText(target, options.statusText.modelText(models, policy, status?.model, sessionId, includeHidden));
    return;
  }

  if (parsed.type === "effort") {
    const effort = parseReasoningEffort(parsed.effort);
    if (!effort) {
      await options.delivery.sendText(target, invalidReasoningEffortText(parsed.effort));
      return;
    }
    let currentModel = currentModelOption(models, policy, status?.model);
    if (!currentModel && !includeHidden) {
      currentModel = currentModelOption(await listModels({ includeHidden: true }), policy, status?.model);
    }
    if (!currentModel) {
      await options.delivery.sendText(target, "无法确认当前模型，不能只设置思考程度。请使用 `/model <模型> <effort>`。");
      return;
    }
    if (!modelSupportsEffort(currentModel, effort)) {
      await options.delivery.sendText(target, unsupportedReasoningEffortText(currentModel, effort));
      return;
    }
    const nextPolicy: CodexModelPolicy = { ...policy, reasoningEffort: effort };
    setModelPolicy(nextPolicy, sessionId);
    await options.delivery.sendText(target, [
      "已设置 Codex 思考程度。",
      `作用范围: ${formatModelScope(sessionId)}`,
      `Model: \`${nextPolicy.model ?? currentModel.model}\``,
      `Effort: \`${effort}\``,
      options.routeQueue.hasWorker(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
    ].filter(Boolean).join("\n"));
    return;
  }

  const resolved = resolveModelReference(parsed.modelRef, models);
  if (resolved.type === "error") {
    await options.delivery.sendText(target, resolved.message);
    return;
  }
  const model = resolved.model;
  const requestedEffort = parsed.effort ? parseReasoningEffort(parsed.effort) : model.defaultReasoningEffort;
  if (parsed.effort && !requestedEffort) {
    await options.delivery.sendText(target, invalidReasoningEffortText(parsed.effort));
    return;
  }
  if (requestedEffort && !modelSupportsEffort(model, requestedEffort)) {
    await options.delivery.sendText(target, unsupportedReasoningEffortText(model, requestedEffort));
    return;
  }
  const nextPolicy: CodexModelPolicy = {
    model: model.model,
    ...(requestedEffort ? { reasoningEffort: requestedEffort } : {}),
  };
  setModelPolicy(nextPolicy, sessionId);
  await options.delivery.sendText(target, [
    "已设置 Codex 模型。",
    `作用范围: ${formatModelScope(sessionId)}`,
    `Model: \`${model.model}\`${model.id !== model.model ? ` (id \`${model.id}\`)` : ""}`,
    `Effort: \`${requestedEffort ?? "default"}\``,
    options.routeQueue.hasWorker(message.routeKey) ? "当前正在运行的任务不会被改写；需要立即生效请先 /stop。" : undefined,
  ].filter(Boolean).join("\n"));
}
