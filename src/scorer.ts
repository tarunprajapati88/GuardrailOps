/**
 * GuardrailOps — Severity Scorer & Alert Decoupler
 *
 * Takes a classification result + user threat history and determines:
 * 1. Final action (ALLOW / WARN / BLOCK)
 * 2. Whether to push an alert (guardrail.push_alert = true/false)
 *
 * KEY DESIGN: push_alert is DECOUPLED from severity.
 * The alert decision is based on domain config + repeat-violation escalation,
 * not just the severity level.
 */

import type {
  ClassificationResult,
  DomainConfig,
  ScoringResult,
  UserThreatState,
  Domain,
  Action,
} from "./types.js";
import { ThreatTracker } from "./threat-tracker.js";

const REPEAT_VIOLATION_THRESHOLD = 3;

export class Scorer {
  private domainConfigs: Record<Domain, DomainConfig>;
  private threatTracker: ThreatTracker;

  constructor(
    domainConfigs: Record<Domain, DomainConfig>,
    threatTracker: ThreatTracker
  ) {
    this.domainConfigs = domainConfigs;
    this.threatTracker = threatTracker;
  }

  /**
   * Score a classification result and determine action + alert.
   */
  score(
    classification: ClassificationResult | null,
    userId: string
  ): ScoringResult {
    // No threat detected — allow through
    if (!classification) {
      return {
        classification: {
          domain: "off-topic" as Domain,
          category: "none",
          severity: "NONE",
          confidence: 0,
          classifier: "heuristic-prefilter",
          classifierLatencyMs: 0,
        },
        action: "ALLOW",
        pushAlert: false,
        userThreatState: this.threatTracker.getState(userId),
        fallbackMessage: null,
      };
    }

    const domainConfig = this.domainConfigs[classification.domain];

    // If domain is not configured, allow through
    if (!domainConfig) {
      return {
        classification,
        action: "ALLOW",
        pushAlert: false,
        userThreatState: this.threatTracker.getState(userId),
        fallbackMessage: null,
      };
    }

    // Determine action from domain config
    const action: Action = domainConfig.action;

    // Update user threat state (only for flaggable domains)
    if (domainConfig.flagUser) {
      this.threatTracker.recordViolation(userId, classification.domain);
    }

    const userState = this.threatTracker.getState(userId);

    // Determine push_alert — DECOUPLED from severity
    let pushAlert = domainConfig.alert;

    // Escalation: if user has repeated violations, force push_alert even if
    // the individual domain wouldn't normally alert
    if (
      userState.violationCount >= REPEAT_VIOLATION_THRESHOLD &&
      domainConfig.flagUser
    ) {
      pushAlert = true;
    }

    // Determine fallback message
    const fallbackMessage =
      action === "BLOCK" ? domainConfig.fallbackMessage : null;

    return {
      classification,
      action,
      pushAlert,
      userThreatState: userState,
      fallbackMessage,
    };
  }
}
