import { randomInt, timingSafeEqual } from "node:crypto";

export interface PairingCodeChallenge {
  routeKey: string;
  code: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
}

export interface PairingCodeManagerOptions {
  ttlMs?: number;
  maxAttempts?: number;
  now?: () => number;
  codeGenerator?: () => string;
}

export type PairingCodeVerifyResult =
  | { ok: true; challenge: PairingCodeChallenge }
  | { ok: false; reason: "missing" | "expired" | "mismatch" | "locked"; challenge?: PairingCodeChallenge };

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_CODE_LENGTH = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class PairingCodeManager {
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => number;
  private readonly codeGenerator: () => string;
  private readonly challenges = new Map<string, PairingCodeChallenge>();

  constructor(options: PairingCodeManagerOptions = {}) {
    this.ttlMs = Math.max(1000, options.ttlMs ?? DEFAULT_TTL_MS);
    this.maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
    this.now = options.now ?? (() => Date.now());
    this.codeGenerator = options.codeGenerator ?? (() => generatePairingCode());
  }

  getOrCreate(routeKey: string): PairingCodeChallenge {
    const existing = this.challenges.get(routeKey);
    if (existing && !this.isExpired(existing) && existing.attempts < existing.maxAttempts) {
      return cloneChallenge(existing);
    }
    const createdAtMs = this.now();
    const challenge: PairingCodeChallenge = {
      routeKey,
      code: this.codeGenerator(),
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(createdAtMs + this.ttlMs).toISOString(),
      attempts: 0,
      maxAttempts: this.maxAttempts,
    };
    this.challenges.set(routeKey, challenge);
    return cloneChallenge(challenge);
  }

  verify(routeKey: string, input: string): PairingCodeVerifyResult {
    const challenge = this.challenges.get(routeKey);
    if (!challenge) return { ok: false, reason: "missing" };
    if (this.isExpired(challenge)) {
      this.challenges.delete(routeKey);
      return { ok: false, reason: "expired", challenge: cloneChallenge(challenge) };
    }
    if (challenge.attempts >= challenge.maxAttempts) {
      this.challenges.delete(routeKey);
      return { ok: false, reason: "locked", challenge: cloneChallenge(challenge) };
    }
    if (!safeCodeEqual(normalizePairingCode(input), normalizePairingCode(challenge.code))) {
      challenge.attempts += 1;
      const reason = challenge.attempts >= challenge.maxAttempts ? "locked" : "mismatch";
      if (reason === "locked") this.challenges.delete(routeKey);
      return { ok: false, reason, challenge: cloneChallenge(challenge) };
    }
    this.challenges.delete(routeKey);
    return { ok: true, challenge: cloneChallenge(challenge) };
  }

  clear(routeKey: string): void {
    this.challenges.delete(routeKey);
  }

  list(): PairingCodeChallenge[] {
    return [...this.challenges.values()].map(cloneChallenge);
  }

  private isExpired(challenge: PairingCodeChallenge): boolean {
    return this.now() >= Date.parse(challenge.expiresAt);
  }
}

export function parsePairingCodeInput(text: string | undefined): string | undefined {
  const normalized = text?.trim();
  if (!normalized) return undefined;
  const command = normalized.match(/^\/pair(?:\s+(.+))?$/i);
  if (command) return command[1]?.trim();
  return looksLikePairingCode(normalized) ? normalized : undefined;
}

export function generatePairingCode(length = DEFAULT_CODE_LENGTH): string {
  const chars: string[] = [];
  for (let index = 0; index < length; index += 1) {
    chars.push(CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  }
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`;
}

export function normalizePairingCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]+/g, "");
}

function looksLikePairingCode(value: string): boolean {
  return /^[A-Z0-9]{3,4}[-\s]?[A-Z0-9]{3,4}$/i.test(value.trim());
}

function safeCodeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    const max = Math.max(leftBuffer.length, rightBuffer.length, 1);
    timingSafeEqual(Buffer.alloc(max), Buffer.alloc(max));
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function cloneChallenge(challenge: PairingCodeChallenge): PairingCodeChallenge {
  return { ...challenge };
}
