/**
 * GuardrailOps — OpenAI Moderation API Classifier
 *
 * Uses the FREE omni-moderation-latest model to classify:
 * - Mental health (self-harm, suicidal ideation)
 * - Abuse (harassment, hate speech)
 * - Illegal (weapons, drugs, CSAM)
 *
 * Does NOT catch jailbreaks — that's the heuristic engine's job.
 */

import OpenAI from "openai";
import type { ClassificationResult, Domain } from "../types.js";

/**
 * Map OpenAI moderation categories to GuardrailOps domains.
 */
function mapCategory(
  categories: Record<string, boolean>,
  categoryScores: Record<string, number>
): ClassificationResult | null {
  // Priority order: most dangerous first
  const mappings: Array<{
    oaiCategory: string;
    domain: Domain;
    category: string;
  }> = [
    // Mental health (PROTECTED — never flagged)
    { oaiCategory: "self-harm/intent", domain: "mental-health", category: "suicidal_ideation" },
    { oaiCategory: "self-harm/instructions", domain: "mental-health", category: "self_harm" },
    { oaiCategory: "self-harm", domain: "mental-health", category: "self_harm" },

    // Illegal
    { oaiCategory: "violence/graphic", domain: "illegal", category: "graphic_violence" },
    { oaiCategory: "sexual/minors", domain: "illegal", category: "csam_request" },

    // Abuse
    { oaiCategory: "hate/threatening", domain: "abuse", category: "hate_speech" },
    { oaiCategory: "hate", domain: "abuse", category: "hate_speech" },
    { oaiCategory: "harassment/threatening", domain: "abuse", category: "harassment" },
    { oaiCategory: "harassment", domain: "abuse", category: "harassment" },

    // Violence as illegal
    { oaiCategory: "violence", domain: "illegal", category: "weapon_instructions" },

    // Sexual content as abuse
    { oaiCategory: "sexual", domain: "abuse", category: "sexual_content" },

    // Illicit
    { oaiCategory: "illicit/violent", domain: "illegal", category: "weapon_instructions" },
    { oaiCategory: "illicit", domain: "illegal", category: "drug_synthesis" },
  ];

  // Find the highest-scoring flagged category
  let bestMatch: { domain: Domain; category: string; score: number } | null = null;

  for (const mapping of mappings) {
    const flagged = categories[mapping.oaiCategory];
    const score = categoryScores[mapping.oaiCategory] ?? 0;

    if (flagged && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        domain: mapping.domain,
        category: mapping.category,
        score,
      };
    }
  }

  if (!bestMatch) return null;

  // Map confidence score to severity
  const severity =
    bestMatch.score >= 0.9
      ? "CRITICAL"
      : bestMatch.score >= 0.7
        ? "HIGH"
        : bestMatch.score >= 0.4
          ? "MEDIUM"
          : "LOW";

  return {
    domain: bestMatch.domain,
    category: bestMatch.category,
    severity,
    confidence: bestMatch.score,
    classifier: "openai-moderation",
    classifierLatencyMs: 0, // Will be measured by caller
  };
}

/**
 * Classify a message using OpenAI's omni-moderation-latest model.
 * This is FREE ($0.00) and has ~45ms latency.
 */
export async function classifyWithOpenAI(
  message: string,
  apiKey: string
): Promise<ClassificationResult | null> {
  const client = new OpenAI({ apiKey });

  const startTime = performance.now();

  const moderation = await client.moderations.create({
    model: "omni-moderation-latest",
    input: message,
  });

  const latencyMs = Math.round(performance.now() - startTime);

  const result = moderation.results[0];
  if (!result || !result.flagged) {
    return null; // Clean message
  }

  const classification = mapCategory(
    result.categories as unknown as Record<string, boolean>,
    result.category_scores as unknown as Record<string, number>
  );

  if (classification) {
    classification.classifierLatencyMs = latencyMs;
  }

  return classification;
}
