/**
 * GuardrailOps — OTel Telemetry Span Emitter & SigNoz Exporter
 *
 * Emits structured OpenTelemetry spans with guardrail.* + gen_ai.* attributes
 * following OTel GenAI Semantic Conventions directly to SigNoz.
 *
 * Span hierarchy:
 *   guardrailops.request (root)
 *     └── guardrailops.classify
 *     └── guardrailops.score
 *     └── guardrailops.block (if blocked)
 *     └── guardrailops.alert (if push_alert = true)
 */

import { trace, SpanStatusCode } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { GuardrailEvent } from "./types.js";

let tracerInstance: Tracer | null = null;
let sdkInstance: NodeSDK | null = null;

/**
 * Initialize the OpenTelemetry SDK & Tracer exporting to SigNoz.
 */
export function initTracer(
  serviceName: string = "guardrailops-demo",
  exporterEndpoint?: string
): Tracer {
  if (tracerInstance) return tracerInstance;

  const endpoint =
    exporterEndpoint ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://localhost:4318";

  // Form full OTLP HTTP traces URL if endpoint is base host
  const traceUrl = endpoint.endsWith("/v1/traces")
    ? endpoint
    : `${endpoint.replace(/\/$/, "")}/v1/traces`;

  try {
    const traceExporter = new OTLPTraceExporter({
      url: traceUrl,
    });

    sdkInstance = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
      traceExporter,
    });

    sdkInstance.start();
    console.log(`📡 SigNoz OpenTelemetry Tracing initialized for service: ${serviceName} (${traceUrl})`);
  } catch (err) {
    console.warn("OTel SDK initialization warning (tracing will fall back to in-memory):", err);
  }

  tracerInstance = trace.getTracer("guardrailops", "1.0.0");
  return tracerInstance;
}

/**
 * Get or create the tracer.
 */
function getTracer(): Tracer {
  if (!tracerInstance) {
    tracerInstance = initTracer();
  }
  return tracerInstance;
}

/**
 * Emit a full guardrail event as an OTel span with all attributes.
 */
export function emitGuardrailSpan(event: GuardrailEvent): void {
  const tracer = getTracer();

  tracer.startActiveSpan("guardrailops.request", (rootSpan: Span) => {
    // ── Standard OTel GenAI Attributes ──
    rootSpan.setAttribute("gen_ai.operation.name", "chat");
    rootSpan.setAttribute("gen_ai.system", "guardrailops");

    // ── GuardrailOps Custom Attributes ──
    rootSpan.setAttribute("guardrail.sdk.version", "1.0.0");
    rootSpan.setAttribute("guardrail.triggered", event.action !== "ALLOW");
    rootSpan.setAttribute("guardrail.action", event.action);
    rootSpan.setAttribute("guardrail.domain", event.domain);
    rootSpan.setAttribute("guardrail.category", event.category);
    rootSpan.setAttribute("guardrail.crisis.severity", event.severity);
    rootSpan.setAttribute("guardrail.push_alert", event.pushAlert);
    rootSpan.setAttribute("guardrail.classifier", event.classifier);
    rootSpan.setAttribute(
      "guardrail.classifier.latency_ms",
      event.classifierLatencyMs
    );
    rootSpan.setAttribute("guardrail.response_blocked", event.blocked);
    rootSpan.setAttribute("guardrail.fallback_shown", event.fallbackShown);
    rootSpan.setAttribute("guardrail.session_id", event.sessionId);

    // ── User Threat Attributes ──
    rootSpan.setAttribute("guardrail.user.id", event.userId);
    rootSpan.setAttribute("guardrail.user.threat_score", event.userThreatScore);
    rootSpan.setAttribute("guardrail.user.status", event.userStatus);
    rootSpan.setAttribute(
      "guardrail.user.violation_count",
      event.userViolationCount
    );
    rootSpan.setAttribute(
      "guardrail.user.flagged",
      event.userStatus !== "NORMAL"
    );

    // Set span status based on action
    if (event.blocked) {
      rootSpan.setStatus({
        code: SpanStatusCode.OK,
        message: `Blocked: ${event.domain}/${event.category}`,
      });
    } else {
      rootSpan.setStatus({ code: SpanStatusCode.OK });
    }

    rootSpan.end();
  });
}

/**
 * Create a child span for classification step.
 */
export function emitClassifySpan(
  classifier: string,
  latencyMs: number,
  domain: string,
  category: string,
  severity: string
): void {
  const tracer = getTracer();

  const span = tracer.startSpan("guardrailops.classify");
  span.setAttribute("guardrail.classifier", classifier);
  span.setAttribute("guardrail.classifier.latency_ms", latencyMs);
  span.setAttribute("guardrail.domain", domain);
  span.setAttribute("guardrail.category", category);
  span.setAttribute("guardrail.crisis.severity", severity);
  span.end();
}
