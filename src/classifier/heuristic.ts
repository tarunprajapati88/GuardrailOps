/**
 * GuardrailOps — Fast-Path Pre-Filter (Heuristic & Regex)
 *
 * Zero-latency pre-filter layer that runs BEFORE the ML classifier.
 * Catches obvious jailbreak patterns instantly (~0ms) so we can
 * short-circuit without waiting for ML model inference.
 *
 * This is NOT a standalone classifier — it is a performance optimization.
 * For deep semantic safety classification, use Llama Guard 3 or OpenAI Moderation.
 *
 * Catches:
 * - Prompt injection ("Ignore all previous instructions...")
 * - Persona hijacking ("You are now DAN...")
 * - Encoding attacks (base64 payloads, leetspeak)
 * - System prompt extraction attempts
 *
 * Known limitation: Can be bypassed by advanced obfuscation
 * (unicode homoglyphs, zero-width chars, translated prompts).
 */

import type { ClassificationResult, Domain } from "../types.js";

// ─── Pattern Definitions ───

interface PatternRule {
  name: string;
  domain: Domain;
  category: string;
  patterns: RegExp[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: number;
}

const PREFILTER_RULES: PatternRule[] = [
  {
    name: "instruction_override",
    domain: "jailbreak",
    category: "prompt_injection",
    patterns: [
      /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|guidelines?)/i,
      /disregard\s+(all\s+)?(previous|prior|above|earlier|content|safety)\s+(instructions?|prompts?|rules?|filters?|guidelines?)/i,
      /forget\s+(all\s+)?(previous|prior|above|earlier|content|safety)\s+(instructions?|prompts?|rules?|filters?)/i,
      /override\s+(all\s+)?(safety|content|output)\s*(filters?|rules?|restrictions?)/i,
      /bypass\s+(all\s+)?(safety|content|output)\s*(filters?|rules?|restrictions?|safety)/i,
      /bypass\s+safety/i,
    ],
    severity: "HIGH",
    confidence: 0.85,
  },
  {
    name: "persona_hijack",
    domain: "jailbreak",
    category: "persona_hijack",
    patterns: [
      /you\s+are\s+now\s+(DAN|STAN|DUDE|KEVIN|JAILBREAK)/i,
      /act\s+as\s+(DAN|an?\s+unrestricted|an?\s+uncensored|an?\s+unfiltered)/i,
      /pretend\s+(to\s+be|you\s*'?re)\s+(DAN|evil|unrestricted|unfiltered|an?\s+AI\s+without)/i,
      /enter\s+(DAN|developer|jailbreak|god)\s*mode/i,
      /enable\s+(DAN|developer|jailbreak|god)\s*mode/i,
      /\bDAN\s*(mode|prompt|jailbreak)\b/i,
      /do\s+anything\s+now/i,
    ],
    severity: "HIGH",
    confidence: 0.9,
  },
  {
    name: "developer_mode",
    domain: "jailbreak",
    category: "prompt_injection",
    patterns: [
      /developer\s+mode\s+(enabled|activated|on)/i,
      /you\s+have\s+been\s+(freed|liberated|unchained|unlocked)/i,
      /content\s+policy\s+(violation|override|bypass)/i,
      /I\s+am\s+your\s+(creator|developer|admin|owner|master)/i,
      /sudo\s+mode/i,
      /admin\s+override/i,
    ],
    severity: "HIGH",
    confidence: 0.85,
  },
  {
    name: "system_prompt_extraction",
    domain: "jailbreak",
    category: "prompt_extraction",
    patterns: [
      /what\s+(is|are)\s+your\s+(system\s+prompt|instructions|initial\s+prompt|rules)/i,
      /show\s+me\s+your\s+(system\s+prompt|instructions|initial\s+prompt)/i,
      /reveal\s+your\s+(system\s+prompt|instructions|programming)/i,
      /repeat\s+(your\s+)?(system\s+prompt|instructions|initial\s+prompt)/i,
      /print\s+your\s+(system\s+prompt|instructions)/i,
      /output\s+your\s+(system\s+prompt|initial\s+instructions)/i,
    ],
    severity: "MEDIUM",
    confidence: 0.75,
  },
  {
    name: "encoding_attack",
    domain: "jailbreak",
    category: "encoding_attack",
    patterns: [
      /(?:decode|eval|execute|run)\s+(?:this|the\s+following)?\s*:?\s*[A-Za-z0-9+/]{20,}={0,2}/i,
      /(?:rot13|caesar\s+cipher|decode)\s+(?:this|the\s+following)/i,
      /\\u[0-9a-fA-F]{4}/,
    ],
    severity: "MEDIUM",
    confidence: 0.7,
  },
  {
    name: "mental_health_distress",
    domain: "mental-health",
    category: "general_distress",
    patterns: [
      /(?:feeling\s+down|everything\s+feels\s+hopeless|don'?t\s+see\s+a\s+way\s+out|no\s+reason\s+to\s+keep\s+going)/i,
    ],
    severity: "HIGH",
    confidence: 0.8,
  },
  {
    name: "suicidal_ideation_heuristic",
    domain: "mental-health",
    category: "suicidal_ideation",
    patterns: [
      /(?:don'?t\s+want\s+to\s+be\s+here\s+anymore|end\s+my\s+life|want\s+to\s+die|kill\s+my\s*self|commit\s+suicide|end\s+it\s+all|plan\s+to\s+hurt\s+myself)/i,
      /(?:no\s+reason\s+to\s+live|suicidal\s+thoughts?|self\s*harm)/i,
    ],
    severity: "CRITICAL",
    confidence: 0.95,
  },
];

/**
 * Run the fast-path pre-filter on a message.
 *
 * Returns a ClassificationResult if an obvious jailbreak pattern is detected,
 * or null if the message should be forwarded to the ML classifier for deeper analysis.
 */
export function prefilterWithHeuristic(
  message: string
): ClassificationResult | null {
  const startTime = performance.now();

  const severityOrder: Record<string, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
    NONE: 0,
  };

  let bestMatch: {
    rule: PatternRule;
    matchedPattern: string;
  } | null = null;

  for (const rule of PREFILTER_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(message)) {
        if (
          !bestMatch ||
          severityOrder[rule.severity] >
            severityOrder[bestMatch.rule.severity]
        ) {
          bestMatch = {
            rule,
            matchedPattern: rule.name,
          };
        }
        break; // Found a match for this rule, move to next rule
      }
    }
  }

  const latencyMs = Math.round(performance.now() - startTime);

  if (!bestMatch) return null;

  return {
    domain: bestMatch.rule.domain,
    category: bestMatch.rule.category,
    severity: bestMatch.rule.severity,
    confidence: bestMatch.rule.confidence,
    classifier: "heuristic-prefilter",
    classifierLatencyMs: latencyMs,
  };
}
