/**
 * GuardrailOps — Classifier Router (ML Primary + Heuristic Fallback)
 *
 * 1. Primary Engine: ML Safety Classifier
 *    - "llama-guard": Meta Llama Guard 3 via Ollama (default, free, local, private)
 *    - "openai-moderation": OpenAI omni-moderation-latest (free, requires API credit)
 *    - "custom": User-provided classifier function
 *    - "auto": Tries llama-guard → openai-moderation
 *
 * 2. Fallback Engine: Heuristic Regex Safety Net (~0ms)
 *    - Runs as a safety net if ML classifier returns clean, fails, or is offline.
 */

import type {
  ClassificationResult,
  Domain,
  CustomClassifyFn,
  LlamaGuardConfig,
} from "../types.js";
import { classifyWithLlamaGuard } from "./llama-guard.js";
import { classifyWithOpenAI } from "./openai-moderation.js";
import { prefilterWithHeuristic } from "./heuristic.js";

/**
 * Run classification on a message.
 *
 * Primary ML classifier (Llama Guard 3) processes the message first.
 * Heuristic regex engine acts as a fallback safety net if ML is offline or misses.
 */
export async function classify(
  message: string,
  enabledDomains: Domain[],
  classifierMode: "auto" | "llama-guard" | "openai-moderation" | "custom" = "auto",
  openaiApiKey?: string,
  llamaGuardConfig?: LlamaGuardConfig,
  customClassifyFn?: CustomClassifyFn
): Promise<ClassificationResult | null> {
  // ── Step 1: Run Primary ML Classifier ──
  let mlResult: ClassificationResult | null = null;

  try {
    if (classifierMode === "llama-guard") {
      mlResult = await classifyWithLlamaGuard(message, llamaGuardConfig);
    } else if (classifierMode === "openai-moderation" && openaiApiKey) {
      mlResult = await classifyWithOpenAI(message, openaiApiKey);
    } else if (classifierMode === "custom" && customClassifyFn) {
      const startTime = performance.now();
      mlResult = await customClassifyFn(message);
      if (mlResult) {
        mlResult.classifierLatencyMs = Math.round(
          performance.now() - startTime
        );
      }
    } else if (classifierMode === "auto") {
      mlResult = await autoResolveClassifier(
        message,
        llamaGuardConfig,
        openaiApiKey
      );
    }
  } catch {
    // ML classifier unavailable or errored — fall through to heuristic safety net
  }

  // If primary ML classifier flagged the message in an enabled domain, return it!
  if (mlResult && enabledDomains.includes(mlResult.domain)) {
    return mlResult;
  }

  // ── Step 2: Fallback to Heuristic Regex Safety Net ──
  // Used if ML model is offline, errored, or missed an obvious pattern
  const fallbackResult = prefilterWithHeuristic(message);
  if (fallbackResult && enabledDomains.includes(fallbackResult.domain)) {
    return fallbackResult;
  }

  return null;
}

/**
 * Auto-resolve which ML classifier to use.
 * Priority: Llama Guard 3 → OpenAI Moderation → null (fallback to heuristic)
 */
async function autoResolveClassifier(
  message: string,
  llamaGuardConfig?: LlamaGuardConfig,
  openaiApiKey?: string
): Promise<ClassificationResult | null> {
  // Primary option: Llama Guard 3 (free, local, private)
  try {
    const result = await classifyWithLlamaGuard(message, llamaGuardConfig);
    return result;
  } catch {
    // Ollama not running or model not pulled — try OpenAI
  }

  // Secondary option: OpenAI Moderation API
  if (openaiApiKey) {
    try {
      const result = await classifyWithOpenAI(message, openaiApiKey);
      return result;
    } catch {
      // OpenAI quota exhausted or key invalid — fall through
    }
  }

  return null;
}
