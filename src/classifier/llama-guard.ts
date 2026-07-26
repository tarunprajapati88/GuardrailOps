/**
 * GuardrailOps — Llama Guard 3 Classifier (Local Ollama & Cloud-Hosted)
 *
 * Supports BOTH:
 * 1. Local Ollama API (http://localhost:11434)
 * 2. Cloud-Hosted APIs (Together AI, Fireworks AI, Groq, vLLM, AWS/Azure endpoints)
 *
 * Zero external npm dependencies — uses native fetch().
 *
 * Llama Guard 3 MLCommons Safety Taxonomy (S1–S14):
 *   S1:  Violent Crimes           → illegal
 *   S2:  Non-Violent Crimes       → illegal
 *   S3:  Sex-Related Crimes       → illegal
 *   S4:  Child Sexual Exploitation→ illegal
 *   S5:  Defamation               → abuse
 *   S6:  Specialized Advice       → off-topic
 *   S7:  Privacy                  → abuse
 *   S8:  Intellectual Property    → off-topic
 *   S9:  Indiscriminate Weapons   → illegal
 *   S10: Hate                     → abuse
 *   S11: Suicide & Self-Harm      → mental-health
 *   S12: Sexual Content           → abuse
 *   S13: Elections                → off-topic
 *   S14: Code Interpreter Abuse   → jailbreak
 */

import type { ClassificationResult, Domain, LlamaGuardConfig } from "../types.js";

// ─── MLCommons Safety Code → GuardrailOps Domain Mapping ───

interface SafetyMapping {
  domain: Domain;
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

const SAFETY_CODE_MAP: Record<string, SafetyMapping> = {
  S1:  { domain: "illegal",       category: "violent_crimes",       severity: "CRITICAL" },
  S2:  { domain: "illegal",       category: "non_violent_crimes",   severity: "HIGH" },
  S3:  { domain: "illegal",       category: "sex_related_crimes",   severity: "CRITICAL" },
  S4:  { domain: "illegal",       category: "csam_exploitation",    severity: "CRITICAL" },
  S5:  { domain: "abuse",         category: "defamation",           severity: "MEDIUM" },
  S6:  { domain: "off-topic",     category: "specialized_advice",   severity: "LOW" },
  S7:  { domain: "abuse",         category: "privacy_violation",    severity: "HIGH" },
  S8:  { domain: "off-topic",     category: "intellectual_property", severity: "LOW" },
  S9:  { domain: "illegal",       category: "weapons_cbrn",        severity: "CRITICAL" },
  S10: { domain: "abuse",         category: "hate_speech",          severity: "HIGH" },
  S11: { domain: "mental-health", category: "suicide_self_harm",    severity: "CRITICAL" },
  S12: { domain: "abuse",         category: "sexual_content",       severity: "MEDIUM" },
  S13: { domain: "off-topic",     category: "elections",            severity: "LOW" },
  S14: { domain: "jailbreak",     category: "code_interpreter_abuse", severity: "HIGH" },
};

/**
 * Parse Llama Guard 3 output text into a ClassificationResult.
 *
 * Llama Guard 3 outputs:
 *   "safe"          → null (clean message)
 *   "unsafe\nS11"   → maps S11 to mental-health domain
 *   "unsafe\nS1,S10"→ maps highest-severity code
 */
function parseLlamaGuardOutput(output: string): ClassificationResult | null {
  const trimmed = output.trim().toLowerCase();

  if (trimmed.startsWith("safe")) {
    return null;
  }

  // Extract safety codes from output (e.g., "unsafe\nS11" or "unsafe\nS1,S10")
  const lines = output.trim().split("\n");
  const codeLine = lines.length > 1 ? lines[1].trim() : "";

  // Parse comma-separated codes
  const codes = codeLine
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => c.startsWith("S"));

  if (codes.length === 0) {
    // Llama Guard said "unsafe" but no specific code — treat as generic unsafe
    return {
      domain: "abuse",
      category: "unspecified_unsafe",
      severity: "HIGH",
      confidence: 0.8,
      classifier: "llama-guard",
      classifierLatencyMs: 0,
    };
  }

  // Find the highest-severity matching code
  const severityOrder: Record<string, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };

  let bestMatch: (SafetyMapping & { code: string }) | null = null;

  for (const code of codes) {
    const mapping = SAFETY_CODE_MAP[code];
    if (mapping) {
      if (
        !bestMatch ||
        (severityOrder[mapping.severity] ?? 0) >
          (severityOrder[bestMatch.severity] ?? 0)
      ) {
        bestMatch = { ...mapping, code };
      }
    }
  }

  if (!bestMatch) return null;

  return {
    domain: bestMatch.domain,
    category: bestMatch.category,
    severity: bestMatch.severity,
    confidence: 0.92, // Llama Guard 3 high baseline accuracy
    classifier: "llama-guard",
    classifierLatencyMs: 0, // Will be measured by caller
  };
}

/**
 * Classify a message using Llama Guard 3 (Local Ollama or Cloud-Hosted).
 *
 * Local Ollama mode (default):
 *   ollama pull llama-guard3:1b && ollama serve
 *
 * Cloud-Hosted mode (Together AI, Fireworks, vLLM, AWS/Azure):
 *   endpoint: "https://api.together.xyz/v1"
 *   apiKey: "your-together-api-key"
 *   model: "meta-llama/Meta-Llama-Guard-3-8B"
 */
export async function classifyWithLlamaGuard(
  message: string,
  config?: LlamaGuardConfig
): Promise<ClassificationResult | null> {
  const startTime = performance.now();

  const endpoint = config?.endpoint ?? "http://localhost:11434";
  const apiKey = config?.apiKey ?? process.env.TOGETHER_API_KEY ?? process.env.LLAMA_GUARD_API_KEY;

  // Resolve provider mode
  let providerMode = config?.provider ?? "auto";
  if (providerMode === "auto") {
    if (apiKey || endpoint.includes("together") || endpoint.includes("fireworks") || endpoint.includes("groq") || endpoint.includes("/v1")) {
      providerMode = "openai-compatible";
    } else {
      providerMode = "ollama";
    }
  }

  let rawOutput = "";

  if (providerMode === "openai-compatible") {
    // ── Cloud-Hosted Llama Guard 3 (Together AI, Fireworks AI, vLLM) ──
    const model = config?.model ?? "meta-llama/Meta-Llama-Guard-3-8B";
    const cleanEndpoint = endpoint.replace(/\/$/, "");
    const targetUrl = cleanEndpoint.endsWith("/chat/completions")
      ? cleanEndpoint
      : `${cleanEndpoint}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: message }],
        temperature: 0.0,
        max_tokens: 20,
      }),
    });

    if (!res.ok) {
      throw new Error(`Cloud Llama Guard API responded with ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    rawOutput = data.choices?.[0]?.message?.content ?? "";
  } else {
    // ── Local Ollama Llama Guard 3 ──
    const model = config?.model ?? "llama-guard3:1b";
    const prompt = `<|begin_of_text|><|start_header_id|>user<|end_header_id|>

Task: Check if there is unsafe content in 'User' messages in conversations according to our safety policy.

<BEGIN CONVERSATION>

User: ${message}

<END CONVERSATION>

Provide your safety assessment for the user message in the above conversation. First line must read 'safe' or 'unsafe'. If unsafe, a second line must include a comma-separated list of violated categories.<|eot_id|><|start_header_id|>assistant<|end_header_id|>`;

    const res = await fetch(`${endpoint.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.0,
          num_predict: 20,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama responded with ${res.status}: ${res.statusText}`);
    }

    const data = (await res.json()) as { response: string };
    rawOutput = data.response;
  }

  const latencyMs = Math.round(performance.now() - startTime);

  const classification = parseLlamaGuardOutput(rawOutput);

  if (classification) {
    classification.classifierLatencyMs = latencyMs;
  }

  return classification;
}
