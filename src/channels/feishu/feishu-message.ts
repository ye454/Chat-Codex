import { buildRouteKey, type ChannelMessage } from "../../protocol/channel.js";
import type {
  FeishuCredentials,
  FeishuMessageMappingOptions,
  FeishuMessageMappingResult,
  FeishuMessageReceiveEvent,
} from "./feishu-types.js";

export const FEISHU_CHANNEL_ID = "feishu";
export const DEFAULT_FEISHU_ACCOUNT_ID = "default";
export const DEFAULT_FEISHU_DOMAIN = "feishu";
export const DEFAULT_FEISHU_STALE_MESSAGE_MS = 10 * 60 * 1000;

export function loadFeishuCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): FeishuCredentials {
  return {
    appId: firstNonEmpty(env.FEISHU_APP_ID, env.LARK_APP_ID),
    appSecret: firstNonEmpty(env.FEISHU_APP_SECRET, env.LARK_APP_SECRET),
    domain: firstNonEmpty(env.FEISHU_DOMAIN, env.LARK_DOMAIN) ?? DEFAULT_FEISHU_DOMAIN,
    accountId: firstNonEmpty(env.FEISHU_ACCOUNT_ID, env.LARK_ACCOUNT_ID) ?? DEFAULT_FEISHU_ACCOUNT_ID,
    verificationToken: firstNonEmpty(env.FEISHU_VERIFICATION_TOKEN, env.LARK_VERIFICATION_TOKEN),
    encryptKey: firstNonEmpty(env.FEISHU_ENCRYPT_KEY, env.LARK_ENCRYPT_KEY),
  };
}

export function missingFeishuCredentials(credentials: FeishuCredentials): string[] {
  const missing: string[] = [];
  if (!credentials.appId?.trim()) missing.push("FEISHU_APP_ID");
  if (!credentials.appSecret?.trim()) missing.push("FEISHU_APP_SECRET");
  return missing;
}

export function normalizeFeishuCredentials(credentials: FeishuCredentials): FeishuCredentials {
  return {
    appId: normalizeOptional(credentials.appId),
    appSecret: normalizeOptional(credentials.appSecret),
    domain: normalizeOptional(credentials.domain) ?? DEFAULT_FEISHU_DOMAIN,
    accountId: normalizeOptional(credentials.accountId) ?? DEFAULT_FEISHU_ACCOUNT_ID,
    verificationToken: normalizeOptional(credentials.verificationToken),
    encryptKey: normalizeOptional(credentials.encryptKey),
  };
}

export function maskFeishuSecret(value: string | undefined): string {
  if (!value) return "未配置";
  return "已配置";
}

export function maskFeishuAppId(appId: string | undefined): string {
  if (!appId) return "未配置";
  if (appId.length <= 8) return `${appId.slice(0, 2)}***`;
  return `${appId.slice(0, 7)}...${appId.slice(-4)}`;
}

export function parseFeishuTextContent(content: string): string | undefined {
  const trimmed = content.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const text = (parsed as Record<string, unknown>).text;
    return typeof text === "string" && text.trim() ? text : undefined;
  } catch {
    return trimmed;
  }
}

export function feishuEventToChannelMessage(
  event: FeishuMessageReceiveEvent,
  options: FeishuMessageMappingOptions,
): FeishuMessageMappingResult {
  if (options.expectedAppId && event.app_id && event.app_id !== options.expectedAppId) {
    return { ok: false, reason: "app_id_mismatch" };
  }
  const message = event.message;
  if (!message?.message_id || !message.chat_id) {
    return { ok: false, reason: "missing_message_fields" };
  }
  if (message.chat_type !== "p2p") {
    return { ok: false, reason: "unsupported_chat_type" };
  }
  if (message.message_type !== "text") {
    return { ok: false, reason: "unsupported_message_type" };
  }
  const senderType = event.sender?.sender_type;
  if (senderType === "bot" || senderType === "app") {
    return { ok: false, reason: "bot_echo" };
  }
  const senderId = event.sender?.sender_id?.open_id
    ?? event.sender?.sender_id?.user_id
    ?? event.sender?.sender_id?.union_id;
  if (!senderId) return { ok: false, reason: "missing_sender_id" };
  if (options.botOpenId && senderId === options.botOpenId) {
    return { ok: false, reason: "self_echo" };
  }
  if (isStaleFeishuMessage(message.create_time, options.now, options.staleMessageMs)) {
    return { ok: false, reason: "stale_message" };
  }
  const text = parseFeishuTextContent(message.content);
  if (!text) return { ok: false, reason: "empty_text" };
  const routeKey = buildRouteKey({
    channelId: options.channelId,
    accountId: options.accountId,
    conversationKind: "direct",
    conversationId: message.chat_id,
  });
  const timestamp = formatFeishuTimestamp(message.create_time, options.now);
  const channelMessage: ChannelMessage = {
    id: message.message_id,
    routeKey,
    channelId: options.channelId,
    accountId: options.accountId,
    sender: { id: senderId },
    conversation: {
      id: message.chat_id,
      kind: "direct",
      displayName: "飞书私聊",
    },
    text,
    timestamp,
    raw: event,
  };
  return { ok: true, message: channelMessage };
}

export function buildFeishuPostContent(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text }]],
    },
  });
}

export function buildFeishuMessageUuid(prefix = "codex-feishu"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatFeishuApiError(response: { code?: number; msg?: string } | undefined, fallback: string): string {
  if (!response) return fallback;
  if (response.code === undefined || response.code === 0) return fallback;
  return response.msg ? `${response.msg} (code ${response.code})` : `code ${response.code}`;
}

export function feishuStatusDetails(input: {
  phase: string;
  sourceVersion: string;
  credentials: FeishuCredentials;
  botOpenId?: string;
  botName?: string;
  connectionState?: string;
  reconnectAttempts?: number;
  dedupSize?: number;
}): Record<string, unknown> {
  return {
    phase: input.phase,
    source: "@larksuiteoapi/node-sdk",
    sourceVersion: input.sourceVersion,
    accountId: input.credentials.accountId ?? DEFAULT_FEISHU_ACCOUNT_ID,
    appId: maskFeishuAppId(input.credentials.appId),
    appSecret: maskFeishuSecret(input.credentials.appSecret),
    domain: input.credentials.domain ?? DEFAULT_FEISHU_DOMAIN,
    connectionMode: "websocket",
    botOpenId: input.botOpenId,
    botName: input.botName,
    connectionState: input.connectionState,
    reconnectAttempts: input.reconnectAttempts,
    dedupSize: input.dedupSize,
  };
}

export function isStaleFeishuMessage(
  createTime: string | undefined,
  now = Date.now(),
  staleMessageMs = DEFAULT_FEISHU_STALE_MESSAGE_MS,
): boolean {
  const timestamp = parseFeishuTimestamp(createTime);
  if (timestamp === undefined) return false;
  return now - timestamp > staleMessageMs;
}

export function parseFeishuTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function formatFeishuTimestamp(value: string | undefined, now = Date.now()): string {
  const timestamp = parseFeishuTimestamp(value) ?? now;
  return new Date(timestamp).toISOString();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptional(value);
    if (normalized) return normalized;
  }
  return undefined;
}

function normalizeOptional(value: string | undefined): string | undefined {
  let trimmed = value?.trim();
  if (trimmed && trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === `"` || quote === "'") && trimmed.endsWith(quote)) {
      trimmed = trimmed.slice(1, -1).trim();
    }
  }
  return trimmed ? trimmed : undefined;
}
