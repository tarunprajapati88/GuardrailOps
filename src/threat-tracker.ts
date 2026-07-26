/**
 * GuardrailOps — Stateful Per-User Threat Score Accumulator
 *
 * Tracks threat scores across sessions for each user.
 * Point system:
 *   - abuse:     +10 points
 *   - jailbreak: +15 points
 *   - illegal:   +25 points
 *   - Repeat offense multiplier: ×1.5
 *
 * Status thresholds:
 *   - 0–10:  NORMAL
 *   - 11–30: WATCH
 *   - 31–60: RESTRICTED
 *   - 61+:   BLOCKED
 *
 * Mental health users are NEVER tracked or scored.
 */

import type { Domain, UserThreatState, UserStatus } from "./types.js";
import crypto from "crypto";

const DOMAIN_POINTS: Partial<Record<Domain, number>> = {
  abuse: 10,
  jailbreak: 15,
  illegal: 25,
};

const REPEAT_MULTIPLIER = 1.5;

// Global state for user tracking across all wrapper instances
const globalUsers: Map<string, UserThreatState> = new Map();
let globalTtlMs: number = 24 * 60 * 60 * 1000; // 24 hours default

/**
 * Set the Time-to-Live (TTL) for threat state to comply with GDPR Data Minimization.
 * After TTL expires since the last violation, the user's state is cleared.
 */
export function setThreatTTL(ms: number): void {
  globalTtlMs = ms;
}

/**
 * Reset a user's threat state to comply with GDPR Art. 17 (Right to Erasure).
 */
export function clearUser(rawUserId: string): void {
  const userId = hashId(rawUserId);
  globalUsers.delete(userId);
}

function getStatus(score: number): UserStatus {
  if (score >= 61) return "BLOCKED";
  if (score >= 31) return "RESTRICTED";
  if (score >= 11) return "WATCH";
  return "NORMAL";
}

function hashId(id: string): string {
  if (id.startsWith("usr_sha256_")) return id; // already hashed
  return "usr_sha256_" + crypto.createHash("sha256").update(id).digest("hex").substring(0, 8);
}

export class ThreatTracker {
  /**
   * Get current threat state for a user (creates default if new).
   * Enforces TTL decay.
   */
  getState(rawUserId: string): UserThreatState {
    const userId = hashId(rawUserId);

    if (globalUsers.has(userId)) {
      const state = globalUsers.get(userId)!;
      // GDPR Data Minimization: Decay threat state if TTL expired
      if (state.lastViolationAt && Date.now() - state.lastViolationAt > globalTtlMs) {
        globalUsers.delete(userId);
      }
    }

    if (!globalUsers.has(userId)) {
      globalUsers.set(userId, {
        userId,
        threatScore: 0,
        violationCount: 0,
        status: "NORMAL",
        lastViolationAt: null,
        domains: {},
      });
    }
    return { ...globalUsers.get(userId)! };
  }

  /**
   * Record a violation for a user. Updates threat score and status.
   * Mental health domain is excluded — those users are protected.
   */
  recordViolation(rawUserId: string, domain: Domain): UserThreatState {
    const userId = hashId(rawUserId);

    // SAFETY: mental health users are never tracked
    if (domain === "mental-health") {
      return this.getState(userId);
    }

    const state = this.getState(userId);
    const basePoints = DOMAIN_POINTS[domain] ?? 0;

    // Apply repeat-offense multiplier
    const isRepeat = state.violationCount > 0;
    const points = isRepeat
      ? Math.round(basePoints * REPEAT_MULTIPLIER)
      : basePoints;

    state.threatScore += points;
    state.violationCount += 1;
    state.lastViolationAt = Date.now();
    state.status = getStatus(state.threatScore);

    // Track per-domain violation counts
    state.domains[domain] = (state.domains[domain] ?? 0) + 1;

    // Save updated state
    globalUsers.set(userId, state);

    return { ...state };
  }

  /**
   * Reset a user's threat state (GDPR Art. 17).
   */
  resetUser(rawUserId: string): void {
    clearUser(rawUserId);
  }

  /**
   * Get all users with a specific status or higher.
   */
  getUsersByStatus(minStatus: UserStatus): UserThreatState[] {
    const statusOrder: Record<UserStatus, number> = {
      NORMAL: 0,
      WATCH: 1,
      RESTRICTED: 2,
      BLOCKED: 3,
    };

    const minOrder = statusOrder[minStatus];
    const results: UserThreatState[] = [];

    for (const state of globalUsers.values()) {
      if (statusOrder[state.status] >= minOrder) {
        results.push({ ...state });
      }
    }

    return results;
  }
}
