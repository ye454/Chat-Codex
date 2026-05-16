import fs from "node:fs";
import path from "node:path";
import {
  LOCAL_STATE_SCHEMA_VERSION,
  type BridgeConfigDocument,
  type ChannelAccountDocument,
  type ChannelInstanceDocument,
  type ChannelInstanceRecord,
} from "./persistent-state-types.js";
import { defaultBridgeStateDir, readJsonFile, writeJsonFileAtomic } from "./state-files.js";

export interface UpsertChannelInstanceInput {
  id: string;
  type: string;
  enabled?: boolean;
  stateDir?: string;
  accountId?: string;
  credentialSource?: string;
  metadata?: Record<string, unknown>;
}

export interface ChannelConfigStoreOptions {
  bridgeDir?: string;
  cwd?: string;
}

export class ChannelConfigStore {
  readonly bridgeDir: string;
  readonly stateRootDir: string;
  private readonly configPath: string;

  constructor(options: ChannelConfigStoreOptions = {}) {
    this.bridgeDir = options.bridgeDir ?? defaultBridgeStateDir(options.cwd);
    this.stateRootDir = path.dirname(this.bridgeDir);
    this.configPath = path.join(this.bridgeDir, "config.json");
  }

  upsertChannelInstance(input: UpsertChannelInstanceInput): ChannelInstanceRecord {
    const now = new Date().toISOString();
    const config = this.readConfig();
    const existing = config.channels.find((channel) => channel.id === input.id);
    const stateDir = input.stateDir ?? existing?.stateDir ?? path.join("state", "channels", input.type, input.id);
    const record: ChannelInstanceRecord = {
      id: input.id,
      type: input.type,
      enabled: input.enabled ?? existing?.enabled ?? true,
      stateDir,
      defaultAccountId: input.accountId ?? existing?.defaultAccountId,
      credentialSource: input.credentialSource ?? existing?.credentialSource,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    config.channels = [
      ...config.channels.filter((channel) => channel.id !== input.id),
      record,
    ].sort((left, right) => left.id.localeCompare(right.id));
    config.updatedAt = now;
    writeJsonFileAtomic(this.configPath, config);
    this.writeInstanceFiles(record, input.accountId, input.metadata);
    return record;
  }

  readConfig(): BridgeConfigDocument {
    const config = readJsonFile<BridgeConfigDocument>(this.configPath, {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: new Date(0).toISOString(),
      channels: [],
    });
    return {
      schemaVersion: config.schemaVersion ?? LOCAL_STATE_SCHEMA_VERSION,
      updatedAt: config.updatedAt ?? new Date(0).toISOString(),
      channels: Array.isArray(config.channels) ? config.channels : [],
      codexDefaults: config.codexDefaults,
    };
  }

  listChannelInstances(): ChannelInstanceRecord[] {
    return [...this.readConfig().channels].sort((left, right) => left.id.localeCompare(right.id));
  }

  setChannelEnabled(id: string, enabled: boolean): ChannelInstanceRecord | undefined {
    const config = this.readConfig();
    const existing = config.channels.find((channel) => channel.id === id);
    if (!existing) return undefined;
    return this.upsertChannelInstance({
      id: existing.id,
      type: existing.type,
      enabled,
      stateDir: existing.stateDir,
      accountId: existing.defaultAccountId,
      credentialSource: existing.credentialSource,
    });
  }

  resolveStateDir(stateDir: string): string {
    return path.isAbsolute(stateDir) ? stateDir : path.resolve(this.stateRootDir, "..", stateDir);
  }

  private writeInstanceFiles(record: ChannelInstanceRecord, accountId: string | undefined, metadata: Record<string, unknown> | undefined): void {
    const absoluteStateDir = this.resolveStateDir(record.stateDir);
    fs.mkdirSync(absoluteStateDir, { recursive: true });
    writeJsonFileAtomic(path.join(absoluteStateDir, "instance.json"), {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      ...record,
    } satisfies ChannelInstanceDocument);
    if (!accountId) return;
    const accountDir = path.join(absoluteStateDir, "accounts", accountId);
    fs.mkdirSync(accountDir, { recursive: true });
    writeJsonFileAtomic(path.join(accountDir, "account.json"), {
      schemaVersion: LOCAL_STATE_SCHEMA_VERSION,
      channelId: record.id,
      channelType: record.type,
      accountId,
      credentialSource: record.credentialSource,
      metadata,
      updatedAt: record.updatedAt,
    } satisfies ChannelAccountDocument);
  }

}
