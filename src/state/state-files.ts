import fs from "node:fs";
import path from "node:path";
import { defaultChatCodexHomeDir, resolveConfiguredUserPath } from "../runtime/user-data-dir.js";

export const CHAT_CODEX_STATE_DIR_ENV = "CHAT_CODEX_STATE_DIR";
export const DEFAULT_STATE_DIR_NAME = "state";

export interface ResolveChatCodexStateRootOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export function resolveChatCodexStateRoot(options: ResolveChatCodexStateRootOptions = {}): string {
  const env = options.env ?? process.env;
  const configured = env[CHAT_CODEX_STATE_DIR_ENV];
  if (configured?.trim()) return resolveConfiguredUserPath(configured, options.cwd);
  return path.join(defaultChatCodexHomeDir(options.homeDir), DEFAULT_STATE_DIR_NAME);
}

export function defaultBridgeStateDir(cwd?: string, env?: NodeJS.ProcessEnv): string {
  return path.join(resolveChatCodexStateRoot({ cwd, env }), "bridge");
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  const text = fs.readFileSync(filePath, "utf-8");
  if (!text.trim()) return fallback;
  return JSON.parse(text) as T;
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const fd = fs.openSync(tmpPath, "w", 0o600);
  try {
    fs.writeFileSync(fd, payload, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
  fs.chmodSync(filePath, 0o600);
  fsyncDirectory(path.dirname(filePath));
}

function fsyncDirectory(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Directory fsync is best-effort across platforms and filesystems.
  }
}
