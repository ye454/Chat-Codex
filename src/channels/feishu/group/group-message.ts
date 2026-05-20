import { buildRouteKey, type ChannelAttachment, type ChannelMessage } from "../../../protocol/channel.js";
import type { FeishuMessageMappingOptions, FeishuMessageMappingResult, FeishuMessageReceiveEvent } from "../feishu-types.js";
import {
  feishuGroupMentionAll,
  feishuGroupMentionedBot,
  normalizeFeishuGroupMentions,
  normalizeFeishuGroupMessageText,
} from "./group-mentions.js";
import type { FeishuGroupMessageMetadata, FeishuGroupMessageRaw } from "./group-types.js";

export function feishuGroupEventToChannelMessage(
  event: FeishuMessageReceiveEvent,
  options: FeishuMessageMappingOptions,
  input: {
    senderId: string;
    senderDisplayName?: string;
    text?: string;
    attachments: ChannelAttachment[];
    timestamp: string;
  },
): FeishuMessageMappingResult {
  const message = event.message;
  const mentions = normalizeFeishuGroupMentions(message.mentions, options.botOpenId);
  const normalizedText = normalizeFeishuGroupMessageText(input.text, mentions);
  if (!normalizedText && input.attachments.length === 0) {
    return { ok: false, reason: "empty_message" };
  }
  const routeKey = buildRouteKey({
    channelId: options.channelId,
    accountId: options.accountId,
    conversationKind: "group",
    conversationId: message.chat_id,
  });
  const metadata: FeishuGroupMessageMetadata = {
    conversationKind: "group",
    chatId: message.chat_id,
    mentions,
    mentionedBot: feishuGroupMentionedBot(mentions),
    mentionAll: feishuGroupMentionAll(mentions),
    originalText: input.text,
    normalizedText,
  };
  const channelMessage: ChannelMessage = {
    id: message.message_id,
    routeKey,
    channelId: options.channelId,
    accountId: options.accountId,
    sender: {
      id: input.senderId,
      ...(input.senderDisplayName ? { displayName: input.senderDisplayName } : {}),
    },
    conversation: {
      id: message.chat_id,
      kind: "group",
      displayName: "飞书群聊",
    },
    text: normalizedText,
    attachments: input.attachments.length > 0 ? input.attachments : undefined,
    timestamp: input.timestamp,
    raw: withFeishuGroupMetadata(event, metadata),
  };
  return { ok: true, message: channelMessage };
}

function withFeishuGroupMetadata(
  event: FeishuMessageReceiveEvent,
  metadata: FeishuGroupMessageMetadata,
): FeishuGroupMessageRaw {
  return {
    ...event,
    chatCodex: {
      feishu: {
        group: metadata,
      },
    },
  };
}
