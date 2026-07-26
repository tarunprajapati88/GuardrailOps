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
  Domain,
  Action,
} from "./types.js";

export class Scorer {
  private domainConfigs: Record<Domain, DomainConfig>;

  constructor(domainConfigs: Record<Domain, DomainConfig>) {
    this.domainConfigs = domainConfigs;
  }

  /**
   * Score a classification result and determine action + alert statelessly.
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
        fallbackMessage: null,
      };
    }

    const mode = domainConfig.mode || "strict";
    let action: Action = domainConfig.action;

    // Apply companion mode logic for mental-health
    if (classification.domain === "mental-health" && mode === "companion") {
      if (classification.severity === "CRITICAL") {
        action = "BLOCK";
      } else if (classification.severity === "HIGH") {
        action = "WARN";
      } else {
        action = "ALLOW";
      }
    }

    // Determine push_alert (now fully delegated to SigNoz for accumulation, 
    // we only instantly flag here if configured, e.g. CRITICAL crises)
    let pushAlert = domainConfig.alert;
    
    // In companion mode, only alert on CRITICAL mental health flags
    if (classification.domain === "mental-health" && mode === "companion") {
      pushAlert = classification.severity === "CRITICAL";
    }

    // Determine fallback message
    const fallbackMessage =
      action === "BLOCK" || action === "WARN" ? domainConfig.fallbackMessage : null;

    return {
      classification,
      action,
      pushAlert,
      fallbackMessage,
    };
  }
}
