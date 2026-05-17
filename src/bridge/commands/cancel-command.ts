import type { ChannelMessage, ChannelTarget } from "../../protocol/channel.js";
import type { PendingMediaManager } from "../inbound-media.js";
import { cancelledPendingMediaText } from "../inbound-media.js";
import type { BridgeDelivery } from "../delivery.js";
import type { BridgeSessionFlow } from "../session-flow.js";

export interface CancelCommandOptions {
  sessionFlow: BridgeSessionFlow;
  pendingMedia: PendingMediaManager;
  delivery: BridgeDelivery;
}

export async function handleCancelCommand(
  options: CancelCommandOptions,
  message: ChannelMessage,
  target: ChannelTarget,
): Promise<void> {
  if (options.sessionFlow.cancelSessionSelection(message.routeKey)) {
    await options.delivery.sendText(target, "已退出切换会话。");
    return;
  }
  const cancelledMedia = options.pendingMedia.cancel(message.routeKey);
  if (cancelledMedia > 0) {
    await options.delivery.sendText(target, cancelledPendingMediaText(cancelledMedia));
    return;
  }
  await options.delivery.sendText(target, "当前没有需要取消的操作。");
}
