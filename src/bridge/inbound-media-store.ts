import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ChannelAttachment, ChannelMessage } from "../protocol/channel.js";
import { defaultChatCodexHomeDir, resolveConfiguredUserPath } from "../runtime/user-data-dir.js";

export const CHAT_CODEX_UPLOAD_DIR_ENV = "CHAT_CODEX_UPLOAD_DIR";
export const DEFAULT_UPLOAD_DIR_NAME = "uploads";

export interface ResolveUploadRootOptions {
  startCwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export interface SaveInboundMediaOptions {
  message: ChannelMessage;
  attachment: ChannelAttachment;
  data: Buffer | Uint8Array;
  rootDir?: string;
  startCwd?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

export interface SavedInboundMedia {
  localPath: string;
  relativePath: string;
  mimeType?: string;
  sizeBytes: number;
}

export function resolveInboundMediaUploadRoot(options: ResolveUploadRootOptions = {}): string {
  const startCwd = options.startCwd ?? process.cwd();
  const env = options.env ?? process.env;
  const configured = env[CHAT_CODEX_UPLOAD_DIR_ENV];
  if (!configured?.trim()) return path.join(defaultChatCodexHomeDir(options.homeDir), DEFAULT_UPLOAD_DIR_NAME);
  return resolveConfiguredUserPath(configured, startCwd);
}

export async function saveInboundMedia(options: SaveInboundMediaOptions): Promise<SavedInboundMedia> {
  const rootDir = options.rootDir ?? resolveInboundMediaUploadRoot({
    startCwd: options.startCwd,
    env: options.env,
  });
  const data = Buffer.from(options.data);
  const mimeType = detectMimeType(data) ?? options.attachment.mimeType;
  const ext = extensionForInboundMedia({
    data,
    mimeType,
    name: options.attachment.name,
    fallbackType: options.attachment.type,
  });
  const relativePath = inboundMediaRelativePath({
    message: options.message,
    attachment: options.attachment,
    ext,
    now: options.now ?? new Date(),
  });
  const localPath = path.join(rootDir, relativePath);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, data, { flag: "wx" });
  return {
    localPath,
    relativePath,
    mimeType,
    sizeBytes: data.byteLength,
  };
}

export function inboundMediaRelativePath(options: {
  message: ChannelMessage;
  attachment: ChannelAttachment;
  ext: string;
  now?: Date;
}): string {
  const date = options.now ?? new Date();
  const yyyyMm = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  const accountId = sanitizePathPart(options.message.accountId ?? "default");
  const messageId = sanitizePathPart(options.message.id);
  const attachmentId = sanitizePathPart(options.attachment.id);
  const filename = `${messageId}-${attachmentId}${normalizeExt(options.ext)}`;
  return path.join(
    sanitizePathPart(options.message.channelId),
    accountId,
    routeHash(options.message.routeKey),
    yyyyMm,
    filename,
  );
}

export function routeHash(routeKey: string): string {
  return createHash("sha256").update(routeKey).digest("hex").slice(0, 16);
}

export function sanitizePathPart(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._-]+/, "").slice(0, 80);
  return sanitized || "unknown";
}

export function extensionForInboundMedia(options: {
  data?: Buffer;
  mimeType?: string;
  name?: string;
  fallbackType?: ChannelAttachment["type"];
}): string {
  const magicMime = options.data ? detectMimeType(options.data) : undefined;
  const mimeExt = extensionFromMimeType(magicMime ?? options.mimeType);
  if (mimeExt) return mimeExt;
  const nameExt = options.name ? normalizeExt(path.extname(options.name)) : "";
  if (nameExt) return nameExt;
  return options.fallbackType === "image" ? ".png" : ".bin";
}

export function detectMimeType(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 6) {
    const header = data.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

function extensionFromMimeType(mimeType: string | undefined): string | undefined {
  switch (mimeType?.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    default:
      return undefined;
  }
}

function normalizeExt(ext: string): string {
  const normalized = ext.trim().toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!normalized) return ".bin";
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}
