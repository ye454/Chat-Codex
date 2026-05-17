import type { CodexAdapter, CodexCollaborationMode, CodexSession } from "../codex/types.js";
import type { ChannelMessage, ChannelTarget } from "../protocol/channel.js";
import { pendingBindingOwnerRouteKey } from "../state/memory-state-store.js";
import type { MemoryStateStore } from "../state/memory-state-store.js";
import type {
  BindSessionResult,
  InitialRouteBinding,
  SessionChoice,
  SessionSelectionState,
  UnboundRoutePolicy,
} from "./bridge-types.js";
import { ROUTE_BUSY_MUTATION_REJECT_TEXT } from "./bridge-types.js";
import {
  formatCollaborationModeForStatus,
  formatSessionChoiceLine,
  isCancelSessionSelectionText,
  ownerConflictError,
  ownerConflictText,
  parseSessionChoiceIndex,
  timestampValue,
} from "./formatters.js";
import type { BridgeDelivery } from "./delivery.js";

export interface BridgeSessionFlowOptions {
  codex: CodexAdapter;
  state: MemoryStateStore;
  delivery: BridgeDelivery;
  cwd: string;
  initialRouteBinding?: InitialRouteBinding;
  unboundRoutePolicy: UnboundRoutePolicy;
  isRouteExecutionBusy(routeKey: string): Promise<boolean>;
  applyStoredSessionRunPolicy(sessionId: string): void;
  collaborationModeForRoute(routeKey: string, sessionId?: string): CodexCollaborationMode;
  hasRouteCollaborationMode(routeKey: string): boolean;
  applyRouteCollaborationModeToSession(routeKey: string, sessionId: string): void;
  syncRouteCollaborationModeFromSession(routeKey: string, sessionId: string): CodexCollaborationMode;
}

export class BridgeSessionFlow {
  private readonly codex: CodexAdapter;
  private readonly state: MemoryStateStore;
  private readonly delivery: BridgeDelivery;
  private readonly cwd: string;
  private readonly unboundRoutePolicy: UnboundRoutePolicy;
  private readonly isRouteExecutionBusy: BridgeSessionFlowOptions["isRouteExecutionBusy"];
  private readonly applyStoredSessionRunPolicy: BridgeSessionFlowOptions["applyStoredSessionRunPolicy"];
  private readonly collaborationModeForRoute: BridgeSessionFlowOptions["collaborationModeForRoute"];
  private readonly hasRouteCollaborationMode: BridgeSessionFlowOptions["hasRouteCollaborationMode"];
  private readonly applyRouteCollaborationModeToSession: BridgeSessionFlowOptions["applyRouteCollaborationModeToSession"];
  private readonly syncRouteCollaborationModeFromSession: BridgeSessionFlowOptions["syncRouteCollaborationModeFromSession"];
  private readonly selections = new Map<string, SessionSelectionState>();
  private pendingInitialRouteBinding?: InitialRouteBinding;
  private pendingInitialRouteKey?: string;

  constructor(options: BridgeSessionFlowOptions) {
    this.codex = options.codex;
    this.state = options.state;
    this.delivery = options.delivery;
    this.cwd = options.cwd;
    this.pendingInitialRouteBinding = options.initialRouteBinding;
    this.unboundRoutePolicy = options.unboundRoutePolicy;
    this.isRouteExecutionBusy = options.isRouteExecutionBusy;
    this.applyStoredSessionRunPolicy = options.applyStoredSessionRunPolicy;
    this.collaborationModeForRoute = options.collaborationModeForRoute;
    this.hasRouteCollaborationMode = options.hasRouteCollaborationMode;
    this.applyRouteCollaborationModeToSession = options.applyRouteCollaborationModeToSession;
    this.syncRouteCollaborationModeFromSession = options.syncRouteCollaborationModeFromSession;
  }

  hasSessionSelection(routeKey: string): boolean {
    return this.selections.has(routeKey);
  }

  pendingInitialBindingForStatus(): InitialRouteBinding | undefined {
    return this.pendingInitialRouteBinding;
  }

  cancelSessionSelection(routeKey: string): boolean {
    return this.selections.delete(routeKey);
  }

  async createNewSession(message: ChannelMessage, target: ChannelTarget): Promise<CodexSession> {
    const session = await this.codex.startSession({
      routeKey: message.routeKey,
      cwd: this.cwd,
      title: `channel:${message.routeKey}`,
    });
    this.state.bindSession(message.routeKey, session);
    this.applyStoredSessionRunPolicy(session.id);
    this.selections.delete(message.routeKey);
    this.clearPendingInitialRouteBindingIfApplies(message);
    this.applyRouteCollaborationModeToSession(message.routeKey, session.id);
    await this.delivery.sendText(target, [
      "已创建新 Codex 会话",
      `Session: ${session.id}`,
      `Cwd: ${session.cwd}`,
      "Status: idle",
      `Mode: ${this.collaborationModeForRoute(message.routeKey, session.id)}`,
    ].join("\n"));
    return session;
  }

  async ensureSession(message: ChannelMessage): Promise<CodexSession> {
    const binding = this.state.getBinding(message.routeKey);
    if (binding) {
      const stored = this.state.getSession(binding.sessionId);
      if (stored) return stored.session;
      const session = await this.codex.resumeSession(binding.sessionId);
      const activated = this.state.activateOwnedSession(message.routeKey, session);
      if (!activated.ok) {
        throw new Error(`Codex session is owned by another route: ${activated.owner?.ownerRouteKey ?? "unknown"}`);
      }
      this.applyStoredSessionRunPolicy(session.id);
      return session;
    }
    if (this.shouldConsumePendingInitialRouteBinding(message)) {
      return await this.consumePendingInitialRouteBinding(message);
    }
    const session = await this.codex.startSession({
      routeKey: message.routeKey,
      cwd: this.cwd,
      title: `channel:${message.routeKey}`,
    });
    this.state.bindSession(message.routeKey, session);
    this.applyStoredSessionRunPolicy(session.id);
    this.applyRouteCollaborationModeToSession(message.routeKey, session.id);
    return session;
  }

  async resumeOrUseSession(
    message: ChannelMessage,
    target: ChannelTarget,
    sessionRef: string | undefined,
  ): Promise<void> {
    if (!sessionRef) {
      await this.beginSessionSelection(message, target);
      return;
    }
    const choiceIndex = parseSessionChoiceIndex(sessionRef);
    if (choiceIndex !== undefined) {
      const choices = await this.sessionChoicesForRoute(message.routeKey);
      const choice = choices[choiceIndex - 1];
      if (!choice) {
        await this.beginSessionSelection(message, target, `没有第 ${choiceIndex} 项，请重新选择。`);
        return;
      }
      const result = await this.bindSessionById(message, target, choice.id);
      if (!result.ok) await this.delivery.sendText(target, result.message);
      return;
    }

    const result = await this.bindSessionById(message, target, sessionRef);
    if (result.ok) return;
    if (result.reason === "owner_conflict") {
      await this.delivery.sendText(target, result.message);
      return;
    }
    await this.beginSessionSelection(message, target, `没有找到 session \`${sessionRef}\`，请从下面选择。`);
  }

  async handleSessionSelectionReply(
    message: ChannelMessage,
    target: ChannelTarget,
    text: string,
  ): Promise<void> {
    const selection = this.selections.get(message.routeKey);
    if (!selection) return;
    if (isCancelSessionSelectionText(text)) {
      this.selections.delete(message.routeKey);
      await this.delivery.sendText(target, "已退出切换会话。");
      return;
    }
    const choiceIndex = parseSessionChoiceIndex(text);
    if (choiceIndex === undefined) {
      await this.delivery.sendText(target, [
        "正在切换 Codex 会话。",
        "请直接回复列表编号，例如 1；回复“取消”退出。",
      ].join("\n"));
      return;
    }
    if (await this.isRouteExecutionBusy(message.routeKey)) {
      await this.delivery.sendText(target, ROUTE_BUSY_MUTATION_REJECT_TEXT);
      return;
    }
    const choice = selection.choices[choiceIndex - 1];
    if (!choice) {
      await this.delivery.sendText(target, this.sessionSelectionText(selection.choices, `没有第 ${choiceIndex} 项，请重新选择。`));
      return;
    }
    const result = await this.bindSessionById(message, target, choice.id);
    if (!result.ok) await this.delivery.sendText(target, result.message);
  }

  shouldAskBeforeBindingSession(message: ChannelMessage): boolean {
    return this.unboundRoutePolicy === "ask"
      && !this.state.getBinding(message.routeKey)
      && !this.shouldConsumePendingInitialRouteBinding(message);
  }

  unboundRoutePromptText(message: ChannelMessage): string {
    return [
      "当前聊天还没有绑定 Codex 会话。",
      "请先发送 /new 创建新会话，或发送 /resume 进入会话选择。",
      `Route: ${message.routeKey}`,
    ].join("\n");
  }

  shouldConsumePendingInitialRouteBinding(message: ChannelMessage): boolean {
    if (this.state.getPendingBindingForMessage(message)) return true;
    return Boolean(
      this.pendingInitialRouteBinding
      && message.conversation.kind === "direct"
      && (!this.pendingInitialRouteKey || this.pendingInitialRouteKey === message.routeKey),
    );
  }

  claimPendingInitialRouteBindingRoute(message: ChannelMessage): void {
    if (!this.pendingInitialRouteBinding) return;
    if (this.pendingInitialRouteKey) return;
    if (message.conversation.kind !== "direct") return;
    if (this.state.getBinding(message.routeKey)) return;
    this.pendingInitialRouteKey = message.routeKey;
  }

  private async bindSessionById(
    message: ChannelMessage,
    target: ChannelTarget,
    sessionId: string,
  ): Promise<BindSessionResult> {
    const claim = this.state.claimSessionOwner(message.routeKey, sessionId);
    if (!claim.ok) {
      return { ok: false, reason: "owner_conflict", message: ownerConflictText(sessionId, claim.owner.ownerRouteKey) };
    }
    try {
      const session = await this.codex.resumeSession(sessionId);
      const activated = this.state.activateOwnedSession(message.routeKey, session);
      if (!activated.ok) {
        if (claim.newlyClaimed) this.state.rollbackSessionOwnerClaim(message.routeKey, sessionId);
        return { ok: false, reason: "owner_conflict", message: ownerConflictText(sessionId, activated.owner?.ownerRouteKey ?? "unknown") };
      }
      const mode = this.syncRouteCollaborationModeFromSession(message.routeKey, session.id);
      this.applyStoredSessionRunPolicy(session.id);
      this.selections.delete(message.routeKey);
      this.clearPendingInitialRouteBindingIfApplies(message);
      await this.delivery.sendText(target, [
        "已绑定 Codex 会话",
        `- 当前会话: \`${session.id}\``,
        `- 工作目录: \`${session.cwd}\``,
        `- 协作模式: ${formatCollaborationModeForStatus(mode)}`,
      ].join("\n"));
      return { ok: true };
    } catch (error) {
      if (claim.newlyClaimed) this.state.rollbackSessionOwnerClaim(message.routeKey, sessionId);
      return { ok: false, reason: "resume_failed", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async consumePendingInitialRouteBinding(message: ChannelMessage): Promise<CodexSession> {
    const persisted = this.state.consumePendingBindingForMessage(message);
    const pending = persisted?.binding ?? this.pendingInitialRouteBinding;
    this.pendingInitialRouteBinding = undefined;
    this.pendingInitialRouteKey = undefined;
    if (!pending || pending.type === "new") {
      const session = await this.codex.startSession({
        routeKey: message.routeKey,
        cwd: this.cwd,
        title: `channel:${message.routeKey}`,
      });
      this.state.bindSession(message.routeKey, session);
      this.applyStoredSessionRunPolicy(session.id);
      this.applyRouteCollaborationModeToSession(message.routeKey, session.id);
      return session;
    }

    const sessionId = pending.sessionId;
    const pendingOwnerRouteKey = persisted ? pendingBindingOwnerRouteKey(persisted.id) : undefined;
    const existingOwner = this.state.getSessionOwner(sessionId);
    const claim = persisted && pendingOwnerRouteKey && existingOwner?.ownerRouteKey === pendingOwnerRouteKey
      ? this.state.transferSessionOwner(pendingOwnerRouteKey, message.routeKey, sessionId)
      : this.state.claimSessionOwner(message.routeKey, sessionId);
    if (!claim.ok) throw ownerConflictError(sessionId, claim.owner?.ownerRouteKey ?? "unknown");
    let session: CodexSession;
    try {
      session = await this.codex.resumeSession(sessionId);
    } catch (error) {
      if ("newlyClaimed" in claim && claim.newlyClaimed) this.state.rollbackSessionOwnerClaim(message.routeKey, sessionId);
      throw error;
    }
    const activated = this.state.activateOwnedSession(message.routeKey, session);
    if (!activated.ok) {
      if ("newlyClaimed" in claim && claim.newlyClaimed) this.state.rollbackSessionOwnerClaim(message.routeKey, sessionId);
      throw ownerConflictError(sessionId, activated.owner?.ownerRouteKey ?? "unknown");
    }
    if (this.hasRouteCollaborationMode(message.routeKey)) {
      this.applyRouteCollaborationModeToSession(message.routeKey, session.id);
    } else {
      this.syncRouteCollaborationModeFromSession(message.routeKey, session.id);
    }
    this.applyStoredSessionRunPolicy(session.id);
    return session;
  }

  private clearPendingInitialRouteBindingIfApplies(message: ChannelMessage): void {
    this.state.clearPendingBindingForMessage(message);
    if (this.shouldConsumePendingInitialRouteBinding(message)) {
      this.pendingInitialRouteBinding = undefined;
      this.pendingInitialRouteKey = undefined;
    }
  }

  private async beginSessionSelection(
    message: ChannelMessage,
    target: ChannelTarget,
    intro?: string,
  ): Promise<void> {
    let choices: SessionChoice[];
    try {
      choices = await this.sessionChoicesForRoute(message.routeKey);
    } catch (error) {
      await this.delivery.sendText(target, `读取 Codex 会话列表失败: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (choices.length === 0) {
      this.selections.delete(message.routeKey);
      await this.delivery.sendText(target, [
        intro,
        "没有可切换的 Codex 会话。",
        "可发送 /new 创建新会话。",
      ].filter(Boolean).join("\n"));
      return;
    }
    this.selections.set(message.routeKey, {
      choices,
      createdAt: Date.now(),
    });
    await this.delivery.sendText(target, this.sessionSelectionText(choices, intro));
  }

  private async sessionChoicesForRoute(routeKey: string): Promise<SessionChoice[]> {
    const currentSessionId = this.state.getBinding(routeKey)?.sessionId;
    const choicesById = new Map<string, SessionChoice>();
    const addChoice = (choice: Omit<SessionChoice, "current">): void => {
      const owner = this.state.getSessionOwner(choice.id);
      if (owner && owner.ownerRouteKey !== routeKey) return;
      const existing = choicesById.get(choice.id);
      choicesById.set(choice.id, {
        id: choice.id,
        title: choice.title ?? existing?.title,
        cwd: choice.cwd ?? existing?.cwd,
        status: choice.status ?? existing?.status ?? { type: "unknown" },
        updatedAt: choice.updatedAt || existing?.updatedAt || "",
        current: choice.id === currentSessionId,
      });
    };

    for (const stored of this.state.listSessions()) {
      addChoice({
        id: stored.session.id,
        title: stored.session.title,
        cwd: stored.session.cwd,
        status: stored.status,
        updatedAt: stored.updatedAt,
      });
    }
    for (const session of await this.codex.listSessions(undefined)) {
      addChoice({
        id: session.id,
        title: session.title,
        cwd: session.cwd,
        status: session.status,
        updatedAt: session.updatedAt,
      });
    }

    return [...choicesById.values()].sort((left, right) => {
      if (left.current !== right.current) return left.current ? -1 : 1;
      return timestampValue(right.updatedAt) - timestampValue(left.updatedAt);
    });
  }

  private sessionSelectionText(choices: SessionChoice[], intro?: string): string {
    return [
      "**切换 Codex 会话**",
      intro,
      "",
      ...choices.map((choice, index) => formatSessionChoiceLine(choice, index)),
      "",
      "直接回复编号完成切换；回复“取消”退出。",
    ].filter((line) => line !== undefined).join("\n");
  }
}
