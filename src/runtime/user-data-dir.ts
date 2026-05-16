import os from "node:os";
import path from "node:path";

export const CHAT_CODEX_HOME_DIR_NAME = ".chat-codex";

export function defaultChatCodexHomeDir(homeDir = os.homedir()): string {
  return path.join(homeDir, CHAT_CODEX_HOME_DIR_NAME);
}

export function resolveConfiguredUserPath(value: string, cwd = process.cwd()): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return path.isAbsolute(normalized) ? normalized : path.resolve(cwd, normalized);
}
