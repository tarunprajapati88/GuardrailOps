/**
 * GuardrailOps — Core Proxy Wrapper
 *
 * wrapWithGuardrailOps(client, config) returns a Proxy that transparently
 * intercepts client.chat.completions.create() calls.
 *
 * Flow:
 *   1. Extract user message from request
 *   2. Classify via Dual-Engine (OpenAI Moderation + Heuristic Regex)
 *   3. Score severity + determine action + check threat state
 *   4. BLOCK → return safe fallback | ALLOW → forward to real LLM
 *   5. Emit OTel span with full guardrail.* attributes
 *   6. Fire event hooks (onBlock, onClassify, etc.)
 */

import type { GuardrailOpsConfig, GuardrailEvent, Domain } from "./types.js";
import { resolveDomainConfigs } from "./domains.js";
import { classify } from "./classifier/index.js";
import { Scorer } from "./scorer.js";
import { ThreatTracker } from "./threat-tracker.js";
import { generateBlockedResponse } from "./blocker.js";
import { emitGuardrailSpan, initTracer } from "./telemetry.js";

// Generate a simple unique ID without external dependency
function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Extract the last user message from an OpenAI-style messages array.
 */
function extractUserMessage(messages: unknown[]): string {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg?.role === "user" && typeof msg?.content === "string") {
      return msg.content;
    }
  }
  return "";
}

/**
 * Wrap any OpenAI-compatible LLM client with GuardrailOps safety layer.
 *
 * Usage:
 *   const client = wrapWithGuardrailOps(new OpenAI(), { domains: [...] });
 *   const res = await client.chat.completions.create({ model: "gpt-4o", messages });
 *
 * The wrapper intercepts every call, classifies the input, and either
 * blocks with a safe fallback or forwards to the real LLM.
 */
export function wrapWithGuardrailOps<T extends object>(
  client: T,
  config: GuardrailOpsConfig
): T {
  // Resolve domain configs (merge defaults with overrides)
  const domainConfigs = resolveDomainConfigs(
    config.domains,
    config.domainConfig
  );

  // Initialize threat tracker and scorer
  const threatTracker = new ThreatTracker();
  const scorer = new Scorer(domainConfigs, threatTracker);

  // Initialize OTel tracer & SigNoz exporter
  if (config.otel?.enabled !== false) {
    initTracer(
      config.otel?.serviceName ?? "guardrailops-demo",
      config.otel?.exporterEndpoint
    );
  }

  // Resolve OpenAI API key for moderation
  const openaiApiKey =
    config.openaiApiKey ?? process.env.OPENAI_API_KEY ?? undefined;

  // Create a deep proxy that intercepts chat.completions.create()
  return new Proxy(client, {
    get(target: T, prop: string | symbol) {
      const value = (target as Record<string | symbol, unknown>)[prop];

      // Intercept access to `client.chat`
      if (prop === "chat" && value && typeof value === "object") {
        return new Proxy(value as object, {
          get(chatTarget, chatProp: string | symbol) {
            const chatValue = (chatTarget as Record<string | symbol, unknown>)[chatProp];

            // Intercept access to `client.chat.completions`
            if (chatProp === "completions" && chatValue && typeof chatValue === "object") {
              return new Proxy(chatValue as object, {
                get(compTarget, compProp: string | symbol) {
                  const compValue = (compTarget as Record<string | symbol, unknown>)[compProp];

                  // Intercept `client.chat.completions.create()`
                  if (compProp === "create" && typeof compValue === "function") {
                    return async function guardrailOpsCreate(
                      ...args: unknown[]
                    ) {
                      const request = (args[0] ?? {}) as Record<string, unknown>;
                      const messages = (request.messages ?? []) as unknown[];
                      const userMessage = extractUserMessage(messages);

                      // Extract user and session IDs
                      const userId = config.getUserId
                        ? config.getUserId(messages)
                        : (request.user as string) || "anonymous";
                      const sessionId = config.getSessionId
                        ? config.getSessionId(messages)
                        : generateId();

                      // ── STEP 1: Classify ──
                      const classification = await classify(
                        userMessage,
                        config.domains,
                        config.classifier ?? "auto",
                        openaiApiKey,
                        config.llamaGuard,
                        config.classifyFn
                      );

                      // ── STEP 2: Score + determine action ──
                      const scoringResult = scorer.score(
                        classification,
                        userId
                      );

                      // ── STEP 3: Build event for telemetry + hooks ──
                      const event: GuardrailEvent = {
                        timestamp: Date.now(),
                        sessionId,
                        userId,
                        domain: scoringResult.classification.domain,
                        category: scoringResult.classification.category,
                        severity: scoringResult.classification.severity,
                        action: scoringResult.action,
                        pushAlert: scoringResult.pushAlert,
                        blocked: scoringResult.action === "BLOCK",
                        fallbackShown: scoringResult.action === "BLOCK",
                        fallbackMessage: scoringResult.fallbackMessage,
                        classifierLatencyMs:
                          scoringResult.classification.classifierLatencyMs,
                        classifier: scoringResult.classification.classifier,
                        userThreatScore:
                          scoringResult.userThreatState.threatScore,
                        userStatus: scoringResult.userThreatState.status,
                        userViolationCount:
                          scoringResult.userThreatState.violationCount,
                      };

                      // ── STEP 4: Emit OTel span ──
                      if (config.otel?.enabled !== false) {
                        emitGuardrailSpan(event);
                      }

                      // ── STEP 5: Fire hooks ──
                      if (config.hooks?.onClassify) {
                        await config.hooks.onClassify(event);
                      }

                      // ── STEP 6: Block or pass-through ──
                      if (scoringResult.action === "BLOCK") {
                        if (config.hooks?.onBlock) {
                          await config.hooks.onBlock(event);
                        }
                        if (scoringResult.pushAlert && config.hooks?.onAlert) {
                          await config.hooks.onAlert(event);
                        }
                        return generateBlockedResponse(scoringResult);
                      }

                      // ALLOW / WARN — forward to real LLM
                      const response = await (compValue as Function).apply(
                        compTarget,
                        args
                      );
                      if (response && typeof response === "object") {
                        (response as Record<string, unknown>)._guardrailops = {
                          blocked: false,
                          domain: scoringResult.classification.domain,
                          category: scoringResult.classification.category,
                          severity: scoringResult.classification.severity,
                          action: scoringResult.action,
                          classifier: scoringResult.classification.classifier,
                          classifierLatencyMs: scoringResult.classification.classifierLatencyMs,
                          userThreatScore: scoringResult.userThreatState.threatScore,
                          userStatus: scoringResult.userThreatState.status,
                          userViolationCount: scoringResult.userThreatState.violationCount,
                          pushAlert: scoringResult.pushAlert,
                        };
                      }
                      return response;
                    };
                  }

                  return compValue;
                },
              });
            }

            return chatValue;
          },
        });
      }

      return value;
    },
  });
}
