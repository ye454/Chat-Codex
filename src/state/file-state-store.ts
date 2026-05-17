import path from "node:path";
import type { CodexRunPolicy } from "../codex/codex-cli.js";
import type { CodexSession } from "../codex/types.js";
import type { ChannelMessage, ConversationKind } from "../protocol/channel.js";
import { MemoryStateStore } from "./memory-state-store.js";
import type { ActivateSessionResult, ClaimSessionResult, SessionBinding, SessionBindingsSnapshot, UnbindSessionResult } from "./session-bindings.js";
import { SessionBindings } from "./session-bindings.js";
import { defaultBridgeStateDir, readJsonFile, writeJsonFileAtomic } from "./state-files.js";
import {
  LOCAL_STATE_SCHEMA_VERSION,
  type RouteIdentityRecord,
  type RouteRecord,
  type RoutesDocument,
  type PendingBindingRecord,
  type PendingBindingsDocument,
  type SessionOwnerRecord,
  type SessionOwnersDocument,
  type SessionPolicyRecord,
  type SessionPoliciesDocument,
  type TrustedRouteRecord,
  type TrustedRoutesDocument,
} from "./persistent-state-types.js";

export interface FileStateStoreOptions {
  rootDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RemoveChannelStateResult {
  channelId: string;
  removedRoutes: number;
  releasedSessions: number;
  removedPendingBindings: number;
}

interface LoadedFileState {
  rootDir: string;
  routes: Map<string, RouteRecord>;
  bindings: SessionBindings;
  sessionPolicies: Map<string, SessionPolicyRecord>;
  pendingBindings: Map<string, PendingBindingRecord>;
  trustedRoutes: Map<string, TrustedRouteRecord>;
}

export class FileStateStore extends MemoryStateStore {
  readonly rootDir: string;
  private routes = new Map<string, RouteRecord>();
  private sessionPolicies = new Map<string, SessionPolicyRecord>();
  private persistedPendingBindings = new Map<string, PendingBindingRecord>();
  private persistedTrustedRoutes = new Map<string, TrustedRouteRecord>();
  private readonly routesPath: string;
  private readonly sessionOwnersPath: string;
  private readonly sessionPoliciesPath: string;
  private readonly pendingBindingsPath: string;
  private readonly trustedRoutesPath: string;

  constructor(options: FileStateStoreOptions = {}) {
    const loaded = loadFileState(options);
    super(loaded.bindings, [...loaded.sessionPolicies.values()], [...loaded.pendingBindings.values()], [...loaded.trustedRoutes.values()]);
    this.rootDir = loaded.rootDir;
    this.routes = loaded.routes;
    this.sessionPolicies = loaded.sessionPolicies;
    this.persistedPendingBindings = loaded.pendingBindings;
    this.persistedTrustedRoutes = loaded.trustedRoutes;
    this.routesPath = path.join(this.rootDir, "routes.json");
    this.sessionOwnersPath = path.join(this.rootDir, "session-owners.json");
    this.sessionPoliciesPath = path.join(this.rootDir, "session-policies.json");
    this.pendingBindingsPath = path.join(this.rootDir, "pending-bindings.json");
    this.trustedRoutesPath = path.join(this.rootDir, "trusted-routes.json");
  }

  override bindSession(routeKey: string, session: CodexSession): SessionBinding {
    const binding = super.bindSession(routeKey, session);
    this.setRouteActiveSession(routeKey, session.id);
    this.persist();
    return binding;
  }

  override claimSessionOwner(routeKey: string, sessionId: string): ClaimSessionResult {
    const result = super.claimSessionOwner(routeKey, sessionId);
    if (result.ok) this.persist();
    return result;
  }

  override activateOwnedSession(routeKey: string, session: CodexSession): ActivateSessionResult {
    const result = super.activateOwnedSession(routeKey, session);
    if (result.ok) {
      this.setRouteActiveSession(routeKey, session.id);
      this.persist();
    }
    return result;
  }

  override unbindSession(routeKey: string): UnbindSessionResult {
    const result = super.unbindSession(routeKey);
    if (result.ok) {
      this.setRouteActiveSession(routeKey, undefined);
      this.persist();
    }
    return result;
  }

  override rollbackSessionOwnerClaim(routeKey: string, sessionId: string): void {
    super.rollbackSessionOwnerClaim(routeKey, sessionId);
    this.persist();
  }

  override transferSessionOwner(fromRouteKey: string, toRouteKey: string, sessionId: string): ReturnType<MemoryStateStore["transferSessionOwner"]> {
    const result = super.transferSessionOwner(fromRouteKey, toRouteKey, sessionId);
    if (result.ok) this.persist();
    return result;
  }

  override setSessionRunPolicy(sessionId: string, policy: CodexRunPolicy): void {
    super.setSessionRunPolicy(sessionId, policy);
    const now = new Date().toISOString();
    const existing = this.sessionPolicies.get(sessionId);
    this.sessionPolicies.set(sessionId, {
      sessionId,
      runPolicy: { ...policy },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.persistSessionPolicies();
  }

  override setPendingBinding(input: Parameters<MemoryStateStore["setPendingBinding"]>[0]): PendingBindingRecord {
    const record = super.setPendingBinding(input);
    this.persistedPendingBindings.set(record.id, record);
    this.persistPendingBindings();
    return record;
  }

  override consumePendingBindingForMessage(message: ChannelMessage): PendingBindingRecord | undefined {
    const record = super.consumePendingBindingForMessage(message);
    if (record) {
      this.persistedPendingBindings.delete(record.id);
      this.persistPendingBindings();
    }
    return record;
  }

  override clearPendingBindingForMessage(message: ChannelMessage): void {
    const record = super.getPendingBindingForMessage(message);
    super.clearPendingBindingForMessage(message);
    if (record) {
      this.persistedPendingBindings.delete(record.id);
      this.persistPendingBindings();
    }
  }

  override deletePendingBinding(id: string): PendingBindingRecord | undefined {
    const record = super.deletePendingBinding(id);
    if (record) {
      this.persistedPendingBindings.delete(record.id);
      this.persist();
    }
    return record;
  }

  override listPendingBindings(): PendingBindingRecord[] {
    return [...this.persistedPendingBindings.values()]
      .map((record) => ({ ...record, binding: { ...record.binding } }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  override listSessionRunPolicies(): SessionPolicyRecord[] {
    return [...this.sessionPolicies.values()]
      .map((policy) => ({
        ...policy,
        runPolicy: { ...policy.runPolicy },
      }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  override recordRouteMessage(message: ChannelMessage): void {
    const existing = this.routes.get(message.routeKey);
    const now = message.timestamp || new Date().toISOString();
    const parsed = parseRouteKey(message.routeKey);
    const record: RouteRecord = {
      routeKey: message.routeKey,
      channelId: message.channelId || existing?.channelId || parsed.channelId,
      channelType: existing?.channelType ?? inferChannelType(message.channelId),
      accountId: message.accountId ?? existing?.accountId ?? parsed.accountId,
      conversationKind: message.conversation.kind,
      conversationId: message.conversation.id,
      activeSessionId: existing?.activeSessionId,
      displayName: message.conversation.displayName ?? existing?.displayName,
      identity: mergeIdentity(existing?.identity, identityFromMessage(message)),
      policy: existing?.policy,
      lastSeenAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.routes.set(message.routeKey, record);
    this.updateTrustedRouteLastSeen(message);
    this.persistRoutes();
  }

  override trustRoute(record: TrustedRouteRecord): TrustedRouteRecord {
    const trusted = super.trustRoute(record);
    this.persistedTrustedRoutes.set(trusted.routeKey, trusted);
    this.persistTrustedRoutes();
    return trusted;
  }

  override revokeRouteTrust(routeKey: string): TrustedRouteRecord | undefined {
    const removed = super.revokeRouteTrust(routeKey);
    if (removed) {
      this.persistedTrustedRoutes.delete(routeKey);
      this.persistTrustedRoutes();
    }
    return removed;
  }

  override listTrustedRoutes(): TrustedRouteRecord[] {
    return [...this.persistedTrustedRoutes.values()]
      .map((route) => ({ ...route }))
      .sort((left, right) => left.routeKey.localeCompare(right.routeKey));
  }

  listRoutes(): RouteRecord[] {
    return [...this.routes.values()].sort((left, right) => left.routeKey.localeCompare(right.routeKey));
  }

  removeChannelState(channelId: string): RemoveChannelStateResult {
    const routes = [...this.routes.values()].filter((route) => route.channelId === channelId);
    const pending = [...this.persistedPendingBindings.values()].filter((record) => record.channelId === channelId);
    const releasedSessions = new Set<string>();

    for (const route of routes) {
      for (const owner of this.sessionBindings.listOwners(route.routeKey)) {
        releasedSessions.add(owner.sessionId);
        this.sessionBindings.rollbackClaim(route.routeKey, owner.sessionId);
      }
      const active = this.sessionBindings.getActive(route.routeKey);
      if (active) {
        releasedSessions.add(active.sessionId);
        this.sessionBindings.unbindActiveSession(route.routeKey);
      }
      this.routes.delete(route.routeKey);
      super.revokeRouteTrust(route.routeKey);
      this.persistedTrustedRoutes.delete(route.routeKey);
    }

    for (const record of pending) {
      const removed = super.deletePendingBinding(record.id);
      if (removed?.binding.type === "existing") releasedSessions.add(removed.binding.sessionId);
      this.persistedPendingBindings.delete(record.id);
    }

    this.persist();
    return {
      channelId,
      removedRoutes: routes.length,
      releasedSessions: releasedSessions.size,
      removedPendingBindings: pending.length,
    };
  }

  private setRouteActiveSession(routeKey: string, sessionId: string | undefined): void {
    const existing = this.routes.get(routeKey);
    const now = new Date().toISOString();
    const parsed = parseRouteKey(routeKey);
    this.routes.set(routeKey, {
      routeKey,
      channelId: existing?.channelId ?? parsed.channelId,
      channelType: existing?.channelType ?? inferChannelType(parsed.channelId),
      accountId: existing?.accountId ?? parsed.accountId,
      conversationKind: existing?.conversationKind ?? parsed.conversationKind,
      conversationId: existing?.conversationId ?? parsed.conversationId,
      activeSessionId: sessionId,
      displayName: existing?.displayName,
      identity: existing?.identity,
      policy: existing?.policy,
      lastSeenAt: existing?.lastSeenAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private persist(): void {
    this.persistRoutes();
    this.persistSessionOwners();
    this.persistSessionPolicies();
    this.persistPendingBindings();
    this.persistTrustedRoutes();
  }

  private persistRoutes(): void {
    writeJsonFileAtomic(this.routesPath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      routes: this.listRoutes(),
    } satisfies RoutesDocument);
  }

  private persistSessionOwners(): void {
    const owners = this.sessionBindings.listOwners()
      .map((owner): SessionOwnerRecord => ({
        sessionId: owner.sessionId,
        ownerRouteKey: owner.ownerRouteKey,
        claimedAt: owner.claimedAt,
        updatedAt: owner.updatedAt,
      }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    writeJsonFileAtomic(this.sessionOwnersPath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      owners,
    } satisfies SessionOwnersDocument);
  }

  private persistSessionPolicies(): void {
    writeJsonFileAtomic(this.sessionPoliciesPath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      policies: this.listSessionRunPolicies(),
    } satisfies SessionPoliciesDocument);
  }

  private persistPendingBindings(): void {
    writeJsonFileAtomic(this.pendingBindingsPath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      pending: this.listPendingBindings(),
    } satisfies PendingBindingsDocument);
  }

  private persistTrustedRoutes(): void {
    writeJsonFileAtomic(this.trustedRoutesPath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      trustedRoutes: this.listTrustedRoutes(),
    } satisfies TrustedRoutesDocument);
  }

  private updateTrustedRouteLastSeen(message: ChannelMessage): void {
    const existing = this.persistedTrustedRoutes.get(message.routeKey);
    if (!existing) return;
    const now = message.timestamp || new Date().toISOString();
    const next: TrustedRouteRecord = {
      ...existing,
      displayName: message.conversation.displayName ?? existing.displayName,
      lastSeenAt: now,
      updatedAt: now,
    };
    this.persistedTrustedRoutes.set(message.routeKey, next);
    super.trustRoute(next);
    this.persistTrustedRoutes();
  }
}

function loadFileState(options: FileStateStoreOptions): LoadedFileState {
  const rootDir = options.rootDir ?? defaultBridgeStateDir(options.cwd, options.env);
  const routes = loadRoutes(path.join(rootDir, "routes.json"));
  const owners = loadOwners(path.join(rootDir, "session-owners.json"));
  const sessionPolicies = loadSessionPolicies(path.join(rootDir, "session-policies.json"));
  const pendingBindings = loadPendingBindings(path.join(rootDir, "pending-bindings.json"));
  const trustedRoutes = loadTrustedRoutes(path.join(rootDir, "trusted-routes.json"));
  const active = [...routes.values()]
    .filter((route): route is RouteRecord & { activeSessionId: string } => Boolean(route.activeSessionId))
    .map((route) => ({
      routeKey: route.routeKey,
      sessionId: route.activeSessionId,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt,
    }));
  const snapshot: SessionBindingsSnapshot = {
    active,
    owners: mergeOwnersWithActiveRoutes(owners, active),
  };
  return {
    rootDir,
    routes,
    bindings: new SessionBindings(snapshot),
    sessionPolicies,
    pendingBindings,
    trustedRoutes,
  };
}

function loadRoutes(filePath: string): Map<string, RouteRecord> {
  const doc = readJsonFile<RoutesDocument>(filePath, emptyRoutesDocument());
  const routes = new Map<string, RouteRecord>();
  for (const route of Array.isArray(doc.routes) ? doc.routes : []) {
    if (!route.routeKey || !route.channelId || !route.accountId || !route.conversationKind || !route.conversationId) continue;
    routes.set(route.routeKey, route);
  }
  return routes;
}

function loadOwners(filePath: string): SessionOwnerRecord[] {
  const doc = readJsonFile<SessionOwnersDocument>(filePath, emptyOwnersDocument());
  return (Array.isArray(doc.owners) ? doc.owners : [])
    .filter((owner) => owner.sessionId && owner.ownerRouteKey);
}

function loadSessionPolicies(filePath: string): Map<string, SessionPolicyRecord> {
  const doc = readJsonFile<SessionPoliciesDocument>(filePath, emptySessionPoliciesDocument());
  const policies = new Map<string, SessionPolicyRecord>();
  for (const policy of Array.isArray(doc.policies) ? doc.policies : []) {
    if (!policy.sessionId || !isRunPolicy(policy.runPolicy)) continue;
    policies.set(policy.sessionId, {
      sessionId: policy.sessionId,
      runPolicy: { ...policy.runPolicy },
      createdAt: policy.createdAt ?? new Date(0).toISOString(),
      updatedAt: policy.updatedAt ?? policy.createdAt ?? new Date(0).toISOString(),
    });
  }
  return policies;
}

function loadPendingBindings(filePath: string): Map<string, PendingBindingRecord> {
  const doc = readJsonFile<PendingBindingsDocument>(filePath, emptyPendingBindingsDocument());
  const pending = new Map<string, PendingBindingRecord>();
  for (const record of Array.isArray(doc.pending) ? doc.pending : []) {
    if (!record.id || !record.channelId || !record.accountId || !isConversationKind(record.conversationKind)) continue;
    if (record.binding?.type !== "new" && !(record.binding?.type === "existing" && record.binding.sessionId)) continue;
    pending.set(record.id, {
      id: record.id,
      channelId: record.channelId,
      accountId: record.accountId,
      conversationKind: record.conversationKind,
      conversationId: record.conversationId,
      label: record.label,
      binding: { ...record.binding },
      createdAt: record.createdAt ?? new Date(0).toISOString(),
      updatedAt: record.updatedAt ?? record.createdAt ?? new Date(0).toISOString(),
    });
  }
  return pending;
}

function loadTrustedRoutes(filePath: string): Map<string, TrustedRouteRecord> {
  const doc = readJsonFile<TrustedRoutesDocument>(filePath, emptyTrustedRoutesDocument());
  const trustedRoutes = new Map<string, TrustedRouteRecord>();
  for (const record of Array.isArray(doc.trustedRoutes) ? doc.trustedRoutes : []) {
    if (!record.routeKey || !record.channelId || !record.accountId || !isConversationKind(record.conversationKind) || !record.conversationId) continue;
    if (!record.trustedAt || !record.trustedBySenderId) continue;
    trustedRoutes.set(record.routeKey, {
      routeKey: record.routeKey,
      channelId: record.channelId,
      accountId: record.accountId,
      conversationKind: record.conversationKind,
      conversationId: record.conversationId,
      displayName: record.displayName,
      trustedAt: record.trustedAt,
      trustedBySenderId: record.trustedBySenderId,
      trustedBySenderDisplayName: record.trustedBySenderDisplayName,
      trustMethod: record.trustMethod === "manual" ? "manual" : "pairing_code",
      lastSeenAt: record.lastSeenAt,
      createdAt: record.createdAt ?? record.trustedAt,
      updatedAt: record.updatedAt ?? record.trustedAt,
    });
  }
  return trustedRoutes;
}

function mergeOwnersWithActiveRoutes(
  owners: SessionOwnerRecord[],
  active: SessionBindingsSnapshot["active"],
): SessionOwnerRecord[] {
  const merged = new Map<string, SessionOwnerRecord>();
  for (const owner of owners) merged.set(owner.sessionId, owner);
  for (const binding of active) {
    if (!merged.has(binding.sessionId)) {
      merged.set(binding.sessionId, {
        sessionId: binding.sessionId,
        ownerRouteKey: binding.routeKey,
        claimedAt: binding.createdAt,
        updatedAt: binding.updatedAt,
      });
    }
  }
  return [...merged.values()];
}

function parseRouteKey(routeKey: string): {
  channelId: string;
  accountId: string;
  conversationKind: ConversationKind;
  conversationId: string;
} {
  const [channelId = "unknown", accountId = "default", kind = "direct", ...conversationParts] = routeKey.split(":");
  const conversationId = conversationParts.join(":") || "unknown";
  return {
    channelId,
    accountId,
    conversationKind: isConversationKind(kind) ? kind : "direct",
    conversationId,
  };
}

function isConversationKind(value: string): value is ConversationKind {
  return value === "direct" || value === "group" || value === "thread";
}

function inferChannelType(channelId: string): string | undefined {
  if (channelId.startsWith("weixin")) return "weixin";
  if (channelId.startsWith("feishu") || channelId.startsWith("lark")) return "feishu";
  if (channelId.startsWith("terminal")) return "terminal";
  if (channelId.startsWith("mock")) return "mock";
  return undefined;
}

function identityFromMessage(message: ChannelMessage): RouteIdentityRecord {
  const feishu = extractFeishuIdentity(message.raw);
  return {
    lastSenderId: message.sender.id,
    lastSenderDisplayName: message.sender.displayName,
    ...feishu,
  };
}

function extractFeishuIdentity(raw: unknown): RouteIdentityRecord {
  if (!raw || typeof raw !== "object") return {};
  const event = raw as {
    tenant_key?: unknown;
    sender?: {
      tenant_key?: unknown;
      sender_id?: {
        open_id?: unknown;
        user_id?: unknown;
        union_id?: unknown;
      };
    };
  };
  return {
    openId: stringOrUndefined(event.sender?.sender_id?.open_id),
    userId: stringOrUndefined(event.sender?.sender_id?.user_id),
    unionId: stringOrUndefined(event.sender?.sender_id?.union_id),
    tenantKey: stringOrUndefined(event.sender?.tenant_key) ?? stringOrUndefined(event.tenant_key),
  };
}

function mergeIdentity(existing: RouteIdentityRecord | undefined, next: RouteIdentityRecord): RouteIdentityRecord {
  return {
    ...existing,
    ...dropUndefinedIdentity(next),
  };
}

function dropUndefinedIdentity(value: RouteIdentityRecord): RouteIdentityRecord {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as RouteIdentityRecord;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRunPolicy(value: unknown): value is CodexRunPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const policy = value as { permissionMode?: unknown; sandbox?: unknown };
  if (policy.permissionMode !== "approval" && policy.permissionMode !== "full") return false;
  return policy.sandbox === undefined
    || policy.sandbox === "read-only"
    || policy.sandbox === "workspace-write"
    || policy.sandbox === "danger-full-access";
}

function emptyRoutesDocument(): RoutesDocument {
  return {
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    routes: [],
  };
}

function emptyOwnersDocument(): SessionOwnersDocument {
  return {
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    owners: [],
  };
}

function emptySessionPoliciesDocument(): SessionPoliciesDocument {
  return {
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    policies: [],
  };
}

function emptyPendingBindingsDocument(): PendingBindingsDocument {
  return {
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    pending: [],
  };
}

function emptyTrustedRoutesDocument(): TrustedRoutesDocument {
  return {
    schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
    updatedAt: new Date(0).toISOString(),
    trustedRoutes: [],
  };
}
