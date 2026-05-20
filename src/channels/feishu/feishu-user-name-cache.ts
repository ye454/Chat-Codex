import path from "node:path";
import { LOCAL_STATE_SCHEMA_VERSION } from "../../state/persistent-state-types.js";
import { readJsonFile, writeJsonFileAtomic } from "../../state/state-files.js";
import type { FeishuApiResponse, FeishuSdkClient } from "./feishu-types.js";

const DEFAULT_USER_NAME_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_EMPTY_USER_NAME_TTL_MS = 24 * 60 * 60 * 1000;

export type FeishuUserNameSource = "event" | "api" | "route-history";

export interface FeishuUserNameRecord {
  openId: string;
  displayName: string;
  source: FeishuUserNameSource;
  lastResolvedAt: string;
  lastSeenAt: string;
  expiresAt: string;
  lastError?: string;
}

export interface FeishuUserNamesDocument {
  schemaVersion: number;
  updatedAt: string;
  users: FeishuUserNameRecord[];
}

export interface FeishuUserNameCacheOptions {
  channelId: string;
  accountId: string;
  stateDir?: string;
  now?: () => number;
  ttlMs?: number;
  emptyTtlMs?: number;
}

export interface ResolveFeishuUserNameResult {
  displayName?: string;
  source?: "cache" | "api";
  error?: string;
}

export class FeishuUserNameCache {
  private readonly cachePath?: string;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly emptyTtlMs: number;
  private loaded = false;
  private readonly users = new Map<string, FeishuUserNameRecord>();

  constructor(options: FeishuUserNameCacheOptions) {
    this.cachePath = options.stateDir
      ? path.join(options.stateDir, "accounts", options.accountId, "user-names.json")
      : undefined;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DEFAULT_USER_NAME_TTL_MS;
    this.emptyTtlMs = options.emptyTtlMs ?? DEFAULT_EMPTY_USER_NAME_TTL_MS;
  }

  seedUserName(openId: string | undefined, displayName: string | undefined, source: FeishuUserNameSource): FeishuUserNameRecord | undefined {
    const id = normalizeNonEmpty(openId);
    const name = normalizeNonEmpty(displayName);
    if (!id || !name) return undefined;
    const record = this.writeRecord(id, name, source, this.ttlMs);
    return { ...record };
  }

  getCachedUserName(openId: string | undefined): ResolveFeishuUserNameResult {
    const record = this.getRecord(openId);
    if (!record) return {};
    if (this.isExpired(record)) return {};
    this.touchLastSeen(record.openId);
    if (!record.displayName) return {};
    return {
      displayName: record.displayName,
      source: "cache",
      error: record.lastError,
    };
  }

  async resolveUserName(openId: string | undefined, client: FeishuSdkClient): Promise<ResolveFeishuUserNameResult> {
    const id = normalizeNonEmpty(openId);
    if (!id) return {};
    const cached = this.getRecord(id);
    if (cached && !this.isExpired(cached)) {
      this.touchLastSeen(id);
      return cached.displayName ? { displayName: cached.displayName, source: "cache", error: cached.lastError } : {};
    }

    const staleName = normalizeNonEmpty(cached?.displayName);
    const resolved = await fetchFeishuUserDisplayName(client, id);
    if (resolved.ok) {
      const name = normalizeNonEmpty(resolved.displayName);
      this.writeRecord(id, name ?? staleName ?? "", name ? "api" : cached?.source ?? "api", name ? this.ttlMs : this.emptyTtlMs);
      return name
        ? { displayName: name, source: "api" }
        : staleName
          ? { displayName: staleName, source: "cache" }
          : {};
    }

    this.writeRecord(id, staleName ?? "", staleName ? cached?.source ?? "api" : "api", this.emptyTtlMs, resolved.error);
    return staleName
      ? { displayName: staleName, source: "cache", error: resolved.error }
      : { error: resolved.error };
  }

  private getRecord(openId: string | undefined): FeishuUserNameRecord | undefined {
    const id = normalizeNonEmpty(openId);
    if (!id) return undefined;
    this.ensureLoaded();
    const record = this.users.get(id);
    return record ? { ...record } : undefined;
  }

  private writeRecord(
    openId: string,
    displayName: string,
    source: FeishuUserNameSource,
    ttlMs: number,
    lastError?: string,
  ): FeishuUserNameRecord {
    this.ensureLoaded();
    const now = new Date(this.now());
    const nowIso = now.toISOString();
    const record: FeishuUserNameRecord = {
      openId,
      displayName,
      source,
      lastResolvedAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      ...(lastError ? { lastError } : {}),
    };
    this.users.set(openId, record);
    this.persist();
    return record;
  }

  private touchLastSeen(openId: string): void {
    this.ensureLoaded();
    const existing = this.users.get(openId);
    if (!existing) return;
    this.users.set(openId, {
      ...existing,
      lastSeenAt: new Date(this.now()).toISOString(),
    });
    this.persist();
  }

  private isExpired(record: FeishuUserNameRecord): boolean {
    const expiresAt = Date.parse(record.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt <= this.now();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.cachePath) return;
    const document = readJsonFile<FeishuUserNamesDocument | undefined>(this.cachePath, undefined);
    for (const record of Array.isArray(document?.users) ? document.users : []) {
      const openId = normalizeNonEmpty(record.openId);
      if (!openId) continue;
      this.users.set(openId, {
        openId,
        displayName: normalizeNonEmpty(record.displayName) ?? "",
        source: normalizeSource(record.source),
        lastResolvedAt: normalizeDate(record.lastResolvedAt) ?? new Date(0).toISOString(),
        lastSeenAt: normalizeDate(record.lastSeenAt) ?? normalizeDate(record.lastResolvedAt) ?? new Date(0).toISOString(),
        expiresAt: normalizeDate(record.expiresAt) ?? new Date(0).toISOString(),
        ...(normalizeNonEmpty(record.lastError) ? { lastError: normalizeNonEmpty(record.lastError) } : {}),
      });
    }
  }

  private persist(): void {
    if (!this.cachePath) return;
    const users = [...this.users.values()].sort((left, right) => left.openId.localeCompare(right.openId));
    writeJsonFileAtomic(this.cachePath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date(this.now()).toISOString(),
      users,
    } satisfies FeishuUserNamesDocument);
  }
}

interface FetchFeishuUserDisplayNameResult {
  ok: boolean;
  displayName?: string;
  error?: string;
}

async function fetchFeishuUserDisplayName(client: FeishuSdkClient, openId: string): Promise<FetchFeishuUserDisplayNameResult> {
  try {
    const response = client.contact?.user?.get
      ? await client.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: "open_id" },
      })
      : client.request
        ? await client.request<FeishuApiResponse<FeishuUserGetData>>({
          method: "GET",
          url: `/open-apis/contact/v3/users/${encodeURIComponent(openId)}?user_id_type=open_id`,
        })
        : undefined;
    if (!response) return { ok: false, error: "飞书 SDK 不支持用户信息接口" };
    if (response.code !== undefined && response.code !== 0) {
      return { ok: false, error: formatFeishuApiResponseError(response) };
    }
    return {
      ok: true,
      displayName: displayNameFromFeishuUserResponse(response),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface FeishuUserGetData {
  user?: {
    name?: string;
    display_name?: string;
    nickname?: string;
    en_name?: string;
  };
  name?: string;
  display_name?: string;
  nickname?: string;
  en_name?: string;
}

function displayNameFromFeishuUserResponse(response: FeishuApiResponse<FeishuUserGetData>): string | undefined {
  const data = response.data;
  const user = data?.user;
  return firstNonEmpty(
    user?.name,
    user?.display_name,
    user?.nickname,
    user?.en_name,
    data?.name,
    data?.display_name,
    data?.nickname,
    data?.en_name,
  );
}

function formatFeishuApiResponseError(response: FeishuApiResponse): string {
  const code = response.code === undefined ? "" : `code=${response.code}`;
  const msg = normalizeNonEmpty(response.msg);
  return ["飞书用户名称解析失败", code, msg].filter(Boolean).join(": ");
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeNonEmpty(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSource(value: string | undefined): FeishuUserNameSource {
  if (value === "event" || value === "api" || value === "route-history") return value;
  return "api";
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
