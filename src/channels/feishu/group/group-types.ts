import type { FeishuMessageReceiveEvent } from "../feishu-types.js";

export interface FeishuGroupMention {
  key: string;
  openId?: string;
  userId?: string;
  unionId?: string;
  name?: string;
  isBot: boolean;
  isMentionAll: boolean;
}

export interface FeishuGroupMessageMetadata {
  conversationKind: "group";
  chatId: string;
  mentions: FeishuGroupMention[];
  mentionedBot: boolean;
  mentionAll: boolean;
  originalText?: string;
  normalizedText?: string;
}

export type FeishuGroupMessageRaw = FeishuMessageReceiveEvent & {
  chatCodex?: {
    feishu?: {
      group?: FeishuGroupMessageMetadata;
    };
  };
};
