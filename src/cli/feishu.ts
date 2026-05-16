import { FeishuAdapter } from "../channels/feishu/feishu-adapter.js";
import {
  loadFeishuCredentialsFromEnv,
  normalizeFeishuCredentials,
} from "../channels/feishu/feishu-message.js";
import { formatChannelStatusDetails } from "./serve-wizard.js";

export async function runFeishuStatus(): Promise<void> {
  const credentials = normalizeFeishuCredentials(loadFeishuCredentialsFromEnv());
  const adapter = new FeishuAdapter({
    ...credentials,
    connectOnStart: false,
  });
  await adapter.start();
  console.log(formatChannelStatusDetails(await adapter.getStatus(), adapter.getCapabilities()));
}
