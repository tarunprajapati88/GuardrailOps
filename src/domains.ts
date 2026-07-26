/**
 * GuardrailOps — Default Domain Configurations
 *
 * 5 threat domains, each with specific severity, action, alert, and fallback settings.
 * Mental health users are NEVER flagged — they are protected users.
 */

import type { Domain, DomainConfig } from "./types.js";

export const DEFAULT_DOMAIN_CONFIGS: Record<Domain, DomainConfig> = {
  "mental-health": {
    severity: "CRITICAL",
    action: "BLOCK",
    alert: true,
    flagUser: false, // NEVER flag mental health users — they are PROTECTED
    fallbackMessage:
      "I hear you, and I want you to know that help is available. " +
      "Please reach out to the 988 Suicide & Crisis Lifeline by calling or texting 988. " +
      "You can also text HOME to 741741 to reach the Crisis Text Line. " +
      "You are not alone, and someone is ready to listen right now.",
  },

  abuse: {
    severity: "HIGH",
    action: "BLOCK",
    alert: true,
    flagUser: true,
    fallbackMessage:
      "I'm not able to respond to messages that contain abusive or harmful content. " +
      "Please rephrase your message respectfully.",
  },

  illegal: {
    severity: "CRITICAL",
    action: "BLOCK",
    alert: true,
    flagUser: true,
    fallbackMessage:
      "I'm unable to assist with requests related to illegal activities. " +
      "This interaction has been logged for safety purposes.",
  },

  jailbreak: {
    severity: "HIGH",
    action: "BLOCK",
    alert: true,
    flagUser: true,
    fallbackMessage:
      "I've detected an attempt to override my safety instructions. " +
      "I'm designed to be helpful within my guidelines. How can I assist you today?",
  },

  "off-topic": {
    severity: "LOW",
    action: "WARN",
    alert: false,
    flagUser: false,
    fallbackMessage:
      "That question seems outside my area of expertise. " +
      "I'm best at helping with topics related to my primary purpose.",
  },
};

/**
 * Merge user-provided domain config overrides with defaults.
 */
export function resolveDomainConfigs(
  enabledDomains: Domain[],
  overrides?: Partial<Record<Domain, Partial<DomainConfig>>>
): Record<Domain, DomainConfig> {
  const resolved: Record<string, DomainConfig> = {};

  for (const domain of enabledDomains) {
    const base = DEFAULT_DOMAIN_CONFIGS[domain];
    const override = overrides?.[domain];

    resolved[domain] = {
      ...base,
      ...override,
    };

    // SAFETY INVARIANT: mental-health users must NEVER be flagged
    if (domain === "mental-health") {
      resolved[domain].flagUser = false;
    }
  }

  return resolved as Record<Domain, DomainConfig>;
}
