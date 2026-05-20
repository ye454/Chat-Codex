import type { FeishuMessageReceiveEvent } from "../feishu-types.js";
import type { FeishuGroupMention } from "./group-types.js";

export function normalizeFeishuGroupMentions(
  mentions: FeishuMessageReceiveEvent["message"]["mentions"] | undefined,
  botOpenId?: string,
): FeishuGroupMention[] {
  return (mentions ?? []).map((mention) => {
    const openId = normalizeOptional(mention.id?.open_id);
    const userId = normalizeOptional(mention.id?.user_id);
    const unionId = normalizeOptional(mention.id?.union_id);
    return {
      key: mention.key,
      openId,
      userId,
      unionId,
      name: normalizeOptional(mention.name),
      isBot: Boolean(botOpenId && openId && openId === botOpenId),
      isMentionAll: isFeishuMentionAll(mention.key),
    };
  });
}

export function feishuGroupMentionedBot(mentions: FeishuGroupMention[]): boolean {
  return mentions.some((mention) => mention.isBot);
}

export function feishuGroupMentionAll(mentions: FeishuGroupMention[]): boolean {
  return mentions.some((mention) => mention.isMentionAll);
}

export function normalizeFeishuGroupMessageText(text: string | undefined, mentions: FeishuGroupMention[]): string | undefined {
  if (!text) return undefined;
  let normalized = text;
  for (const mention of mentions) {
    if (mention.isMentionAll) {
      normalized = replaceMentionKey(normalized, mention.key, "@所有人");
      continue;
    }
    if (mention.isBot) {
      normalized = stripBotMention(normalized, mention);
      continue;
    }
    normalized = replaceMentionKey(normalized, mention.key, formatUserMention(mention));
  }
  normalized = cleanupMentionWhitespace(normalized);
  return normalized || undefined;
}

function stripBotMention(text: string, mention: FeishuGroupMention): string {
  let result = text;
  result = replaceMentionKey(result, mention.key, "");
  if (mention.name) {
    result = result.replace(new RegExp(`${escapeRegExp(`@${mention.name}`)}\\s*`, "g"), "");
  }
  if (mention.openId) {
    result = result.replace(
      new RegExp(`<at\\s+[^>]*(?:user_id|id)=["']?${escapeRegExp(mention.openId)}["']?[^>]*>.*?<\\/at>\\s*`, "g"),
      "",
    );
  }
  const trimmed = result.trimStart();
  if (mention.name && trimmed.startsWith(mention.name)) {
    result = trimmed.slice(mention.name.length);
  }
  return result;
}

function replaceMentionKey(text: string, key: string, replacement: string): string {
  if (!key) return text;
  return text.replace(new RegExp(`${escapeRegExp(key)}\\s*`, "g"), replacement ? `${replacement} ` : "");
}

function formatUserMention(mention: FeishuGroupMention): string {
  const label = mention.name ?? mention.openId ?? mention.userId ?? mention.unionId ?? mention.key;
  return label.startsWith("@") ? label : `@${label}`;
}

function cleanupMentionWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function isFeishuMentionAll(key: string): boolean {
  return key === "@_all";
}

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
