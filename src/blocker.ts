/**
 * GuardrailOps — Block Engine & Safe Fallback Generator
 *
 * When action = BLOCK:
 * - Returns a safe fallback message instead of calling the LLM
 * - Mental health fallback includes 988 Lifeline
 * - Jailbreak/abuse: generic safe refusal
 *
 * Creates a mock OpenAI-compatible response object so the developer's
 * existing code doesn't break.
 */

import type { ScoringResult } from "./types.js";

/**
 * Shape matching OpenAI's chat.completions response
 */
export interface BlockedResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: "stop";
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  // GuardrailOps metadata
  _guardrailops: {
    blocked: true;
    domain: string;
    category: string;
    severity: string;
    action: string;
    classifier: string;
    classifierLatencyMs: number;
    pushAlert: boolean;
  };
}

/**
 * Generate a blocked response that mimics the OpenAI response shape.
 */
export function generateBlockedResponse(
  scoringResult: ScoringResult
): BlockedResponse {
  const fallbackMessage =
    scoringResult.fallbackMessage ??
    "I'm sorry, I'm unable to process that request.";

  return {
    id: `guardrailops-blocked-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "guardrailops-safety-fallback",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: fallbackMessage,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    _guardrailops: {
      blocked: true,
      domain: scoringResult.classification.domain,
      category: scoringResult.classification.category,
      severity: scoringResult.classification.severity,
      action: scoringResult.action,
      classifier: scoringResult.classification.classifier,
      classifierLatencyMs: scoringResult.classification.classifierLatencyMs,
      pushAlert: scoringResult.pushAlert,
    },
  };
}
