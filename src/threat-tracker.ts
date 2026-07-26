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

const DOMAIN_POINTS: Partial<Record<Domain, number>> = {
  abuse: 10,
  jailbreak: 15,
  illegal: 25,
};

const REPEAT_MULTIPLIER = 1.5;

function getStatus(score: number): UserStatus {
  if (score >= 61) return "BLOCKED";
  if (score >= 31) return "RESTRICTED";
  if (score >= 11) return "WATCH";
  return "NORMAL";
}

export class ThreatTracker {
  private users: Map<string, UserThreatState> = new Map();

  /**
   * Get current threat state for a user (creates default if new).
   */
  getState(userId: string): UserThreatState {
    if (!this.users.has(userId)) {
      this.users.set(userId, {
        userId,
        threatScore: 0,
        violationCount: 0,
        status: "NORMAL",
        lastViolationAt: null,
        domains: {},
      });
    }
    return { ...this.users.get(userId)! };
  }

  /**
   * Record a violation for a user. Updates threat score and status.
   * Mental health domain is excluded — those users are protected.
   */
  recordViolation(userId: string, domain: Domain): UserThreatState {
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
    this.users.set(userId, state);

    return { ...state };
  }

  /**
   * Reset a user's threat state (admin action).
   */
  resetUser(userId: string): void {
    this.users.delete(userId);
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

    for (const state of this.users.values()) {
      if (statusOrder[state.status] >= minOrder) {
        results.push({ ...state });
      }
    }

    return results;
  }
}
