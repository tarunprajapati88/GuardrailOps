/**
 * GuardrailOps — Programmatic SigNoz Alert Provisioner
 *
 * Automatically provisions SigNoz Alert Rules & Webhook Channels
 * via SigNoz REST API on startup.
 */

export interface ProvisionAlertsConfig {
  /** SigNoz Base URL (default: http://localhost:8080 or process.env.SIGNOZ_URL) */
  signozUrl?: string;

  /** Webhook Relay URL (default: http://webhook-relay:3001/alert or process.env.SLACK_RELAY_URL) */
  webhookUrl?: string;

  /** SigNoz API Key (if authentication is enabled) */
  apiKey?: string;

  /** Violation threshold count to trigger alert (default: 3) */
  threshold?: number;

  /** Time window in minutes to evaluate violations (default: 5) */
  timeWindowMin?: number;
}

/**
 * Programmatically provision SigNoz Alert Channels and Trace Alert Rules via SigNoz REST API.
 */
export async function provisionSigNozAlerts(
  config: ProvisionAlertsConfig = {}
): Promise<boolean> {
  const signozUrl = (
    config.signozUrl ||
    process.env.SIGNOZ_URL ||
    "http://localhost:8080"
  ).replace(/\/$/, "");

  const webhookUrl =
    config.webhookUrl ||
    process.env.SLACK_RELAY_URL ||
    "http://webhook-relay:3001/alert";

  const apiKey = config.apiKey || process.env.SIGNOZ_API_KEY || "";
  const threshold = config.threshold || 3;
  const timeWindowMin = config.timeWindowMin || 5;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["SIGNOZ-API-KEY"] = apiKey;
  }

  try {
    // 1. Programmatically Provision Webhook Channel in SigNoz
    console.log(`📡 Programmatically provisioning SigNoz Webhook Channel -> ${webhookUrl}...`);
    const channelRes = await fetch(`${signozUrl}/api/v1/channels`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "GuardrailOps Slack Webhook Relay",
        type: "webhook",
        webhook_configs: [{ url: webhookUrl }],
      }),
    });

    if (channelRes.ok) {
      console.log(`✅ SigNoz Webhook Channel programmatically provisioned!`);
    } else {
      console.log(`ℹ️ SigNoz Webhook Channel status: ${channelRes.status} (${channelRes.statusText})`);
    }

    // 2. Programmatically Provision Trace Alert Rule in SigNoz
    console.log(`📡 Programmatically provisioning SigNoz Trace Alert Rule (> ${threshold} blocks / ${timeWindowMin}m)...`);
    const ruleRes = await fetch(`${signozUrl}/api/v1/rules`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        alert: "GuardrailOps Repeat Threat Attacker",
        alertType: "trace_metric",
        evalWindow: `${timeWindowMin}m`,
        frequency: "1m",
        condition: {
          target: threshold,
          op: "GT",
        },
        labels: {
          severity: "critical",
          guardrail_domain: "abuse",
          guardrail_category: "repeat_violations",
        },
      }),
    });

    if (ruleRes.ok) {
      console.log(`✅ SigNoz Trace Alert Rule programmatically provisioned!`);
    } else {
      console.log(`ℹ️ SigNoz Trace Alert Rule status: ${ruleRes.status} (${ruleRes.statusText})`);
    }

    return true;
  } catch (err) {
    console.warn("SigNoz alert auto-provisioning warning (SigNoz API unreachable or running in mock mode):", err);
    return false;
  }
}
