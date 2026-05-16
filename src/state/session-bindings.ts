import type { CodexSession } from "../codex/types.js";

export interface SessionBinding {
  routeKey: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionOwner {
  sessionId: string;
  ownerRouteKey: string;
  claimedAt: string;
  updatedAt: string;
}

export interface SessionBindingsSnapshot {
  active: SessionBinding[];
  owners: SessionOwner[];
}

export type ClaimSessionResult =
  | { ok: true; owner: SessionOwner; newlyClaimed: boolean }
  | { ok: false; reason: "owned_by_other_route"; owner: SessionOwner };

export type TransferSessionOwnerResult =
  | { ok: true; owner: SessionOwner }
  | { ok: false; reason: "not_owned_by_source"; owner?: SessionOwner };

export type ActivateSessionResult =
  | { ok: true; binding: SessionBinding; owner: SessionOwner }
  | { ok: false; reason: "not_owned_by_route"; owner?: SessionOwner };

export type UnbindSessionResult =
  | { ok: true; binding: SessionBinding }
  | { ok: false; reason: "no_active_session" };

export class SessionBindings {
  private readonly activeByRoute = new Map<string, SessionBinding>();
  private readonly ownersBySession = new Map<string, SessionOwner>();
  private readonly routeSessions = new Map<string, Set<string>>();

  constructor(snapshot?: Partial<SessionBindingsSnapshot>) {
    for (const owner of snapshot?.owners ?? []) {
      this.ownersBySession.set(owner.sessionId, { ...owner });
      this.addRouteSession(owner.ownerRouteKey, owner.sessionId);
    }
    for (const binding of snapshot?.active ?? []) {
      this.activeByRoute.set(binding.routeKey, { ...binding });
      this.addRouteSession(binding.routeKey, binding.sessionId);
      if (!this.ownersBySession.has(binding.sessionId)) {
        this.ownersBySession.set(binding.sessionId, {
          sessionId: binding.sessionId,
          ownerRouteKey: binding.routeKey,
          claimedAt: binding.createdAt,
          updatedAt: binding.updatedAt,
        });
      }
    }
  }

  bindNewSession(routeKey: string, session: CodexSession): SessionBinding {
    const now = new Date().toISOString();
    const existingOwner = this.ownersBySession.get(session.id);
    if (existingOwner && existingOwner.ownerRouteKey !== routeKey) {
      throw new Error(`session ${session.id} is owned by another route`);
    }
    const owner: SessionOwner = {
      sessionId: session.id,
      ownerRouteKey: routeKey,
      claimedAt: existingOwner?.claimedAt ?? now,
      updatedAt: now,
    };
    this.releaseReplacedActiveOwner(routeKey, session.id);
    this.ownersBySession.set(session.id, owner);
    return this.setActive(routeKey, session.id, now);
  }

  claimSessionOwner(routeKey: string, sessionId: string): ClaimSessionResult {
    const now = new Date().toISOString();
    const existing = this.ownersBySession.get(sessionId);
    if (existing && existing.ownerRouteKey !== routeKey) {
      return { ok: false, reason: "owned_by_other_route", owner: existing };
    }
    if (existing) {
      const owner = { ...existing, updatedAt: now };
      this.ownersBySession.set(sessionId, owner);
      return { ok: true, owner, newlyClaimed: false };
    }
    const owner: SessionOwner = {
      sessionId,
      ownerRouteKey: routeKey,
      claimedAt: now,
      updatedAt: now,
    };
    this.ownersBySession.set(sessionId, owner);
    return { ok: true, owner, newlyClaimed: true };
  }

  activateOwnedSession(routeKey: string, session: CodexSession): ActivateSessionResult {
    const owner = this.ownersBySession.get(session.id);
    if (!owner || owner.ownerRouteKey !== routeKey) {
      return { ok: false, reason: "not_owned_by_route", owner };
    }
    this.releaseReplacedActiveOwner(routeKey, session.id);
    return {
      ok: true,
      binding: this.setActive(routeKey, session.id),
      owner: this.ownersBySession.get(session.id) ?? owner,
    };
  }

  unbindActiveSession(routeKey: string): UnbindSessionResult {
    const binding = this.activeByRoute.get(routeKey);
    if (!binding) return { ok: false, reason: "no_active_session" };
    this.activeByRoute.delete(routeKey);
    const owner = this.ownersBySession.get(binding.sessionId);
    if (owner?.ownerRouteKey === routeKey) {
      this.ownersBySession.delete(binding.sessionId);
    }
    this.routeSessions.get(routeKey)?.delete(binding.sessionId);
    return { ok: true, binding };
  }

  rollbackClaim(routeKey: string, sessionId: string): void {
    const owner = this.ownersBySession.get(sessionId);
    if (owner?.ownerRouteKey === routeKey) {
      this.ownersBySession.delete(sessionId);
      this.routeSessions.get(routeKey)?.delete(sessionId);
    }
  }

  transferSessionOwner(fromRouteKey: string, toRouteKey: string, sessionId: string): TransferSessionOwnerResult {
    const existing = this.ownersBySession.get(sessionId);
    if (!existing || existing.ownerRouteKey !== fromRouteKey) {
      return { ok: false, reason: "not_owned_by_source", owner: existing };
    }
    const now = new Date().toISOString();
    const owner: SessionOwner = {
      sessionId,
      ownerRouteKey: toRouteKey,
      claimedAt: existing.claimedAt,
      updatedAt: now,
    };
    this.ownersBySession.set(sessionId, owner);
    this.routeSessions.get(fromRouteKey)?.delete(sessionId);
    this.addRouteSession(toRouteKey, sessionId);
    return { ok: true, owner };
  }

  getActive(routeKey: string): SessionBinding | undefined {
    return this.activeByRoute.get(routeKey);
  }

  getOwner(sessionId: string): SessionOwner | undefined {
    return this.ownersBySession.get(sessionId);
  }

  listRouteSessions(routeKey: string): string[] {
    return [...(this.routeSessions.get(routeKey) ?? [])];
  }

  listOwners(routeKey?: string): SessionOwner[] {
    const owners = [...this.ownersBySession.values()];
    return routeKey ? owners.filter((owner) => owner.ownerRouteKey === routeKey) : owners;
  }

  snapshot(): SessionBindingsSnapshot {
    return {
      active: [...this.activeByRoute.values()].map((binding) => ({ ...binding })),
      owners: [...this.ownersBySession.values()].map((owner) => ({ ...owner })),
    };
  }

  private setActive(routeKey: string, sessionId: string, now = new Date().toISOString()): SessionBinding {
    const existing = this.activeByRoute.get(routeKey);
    const binding: SessionBinding = {
      routeKey,
      sessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.activeByRoute.set(routeKey, binding);
    this.addRouteSession(routeKey, sessionId);
    const owner = this.ownersBySession.get(sessionId);
    if (owner?.ownerRouteKey === routeKey) {
      this.ownersBySession.set(sessionId, { ...owner, updatedAt: now });
    }
    return binding;
  }

  private releaseReplacedActiveOwner(routeKey: string, nextSessionId: string): void {
    const previous = this.activeByRoute.get(routeKey);
    if (!previous || previous.sessionId === nextSessionId) return;
    const previousOwner = this.ownersBySession.get(previous.sessionId);
    if (previousOwner?.ownerRouteKey === routeKey) {
      this.ownersBySession.delete(previous.sessionId);
      this.routeSessions.get(routeKey)?.delete(previous.sessionId);
    }
  }

  private addRouteSession(routeKey: string, sessionId: string): void {
    const routeSessions = this.routeSessions.get(routeKey) ?? new Set<string>();
    routeSessions.add(sessionId);
    this.routeSessions.set(routeKey, routeSessions);
  }
}
