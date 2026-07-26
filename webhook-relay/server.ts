/**
 * SigNoz Alert → Slack Push Notification Webhook Relay
 *
 * Receives alert webhook HTTP POST payloads from SigNoz/GuardrailOps,
 * formats rich Slack Block Kit cards, and pushes notifications directly
 * to Slack channels via Incoming Webhooks (SLACK_WEBHOOK_URL).
 */

/// <reference types="node" />
import express from "express";

const app = express();
app.use(express.json());

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Send message to Slack channel via Incoming Webhook
 */
async function sendSlackMessage(details: {
  userId: string;
  domain: string;
  category: string;
  severity: string;
  sessionId: string;
  isMentalHealth: boolean;
  threatScore?: number;
  classifier?: string;
  latencyMs?: number;
}): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    console.log(
      `\n[SLACK RELAY MOCK ALERT]: ${details.isMentalHealth ? "🆘 CRISIS" : "🚨 ALERT"} for ${details.userId} (${details.domain}/${details.category}) via ${details.classifier ?? "llama-guard"} (${details.latencyMs ?? 0}ms)`
    );
    return true;
  }

  const title = details.isMentalHealth
    ? "🆘 CRITICAL MENTAL HEALTH CRISIS ALERT"
    : "🚨 CRITICAL GUARDRAIL THREAT ALERT";

  const payload = {
    text: `${title}: ${details.domain} / ${details.category} (User: ${details.userId})`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: title, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*User ID / Email:*\n\`${details.userId}\`` },
          { type: "mrkdwn", text: `*Threat Domain:*\n${details.domain}` },
          { type: "mrkdwn", text: `*Violation Category:*\n${details.category}` },
          { type: "mrkdwn", text: `*Crisis Severity:*\n${details.severity}` },
          { type: "mrkdwn", text: `*Session ID:*\n\`${details.sessionId}\`` },
          { type: "mrkdwn", text: `*Engine Latency:*\n\`${details.classifier ?? "llama-guard"}\` (${details.latencyMs ?? 0}ms)` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: details.isMentalHealth
            ? "⚠️ *IMMEDIATE INTERVENTION RECOMMENDED:* User triggered suicide/self-harm safeguard. 988 Lifeline presented to user."
            : `🔴 *Action Taken:* Request blocked. Investigating trace in SigNoz Trace Explorer.`,
        },
      },
    ],
  };

  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch (err) {
    console.error("Slack webhook send error:", err);
    return false;
  }
}

app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="font-family: system-ui, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc;">
        <h2>📲 GuardrailOps → Slack Webhook Relay</h2>
        <p>Status: <strong style="color: #22c55e;">ONLINE</strong></p>
        <p>Endpoint: <code>POST /alert</code> (Pushes Block Kit alert cards to Slack)</p>
      </body>
    </html>
  `);
});

app.get("/alert", (req, res) => {
  res.json({
    service: "GuardrailOps Slack Webhook Relay",
    status: "online",
    slackConfigured: !!SLACK_WEBHOOK_URL,
    endpoint: "POST /alert",
  });
});

app.post("/alert", async (req, res) => {
  try {
    const payload = req.body;
    console.log("Received Alert Payload:", JSON.stringify(payload, null, 2));

    // Extract alert details from payload (SigNoz alert or SDK event)
    const domain = payload.domain ?? payload.labels?.guardrail_domain ?? "jailbreak";
    const category = payload.category ?? payload.labels?.guardrail_category ?? "prompt_injection";
    const sessionId = payload.sessionId ?? payload.labels?.guardrail_session_id ?? "sess_unknown";
    const userId = payload.userId ?? payload.labels?.guardrail_user_id ?? payload.user_id ?? "sarah.connor@acme.com";
    const severity = payload.severity ?? payload.labels?.guardrail_crisis_severity ?? "CRITICAL";
    const classifier = payload.classifier ?? payload.labels?.guardrail_classifier ?? "llama-guard";
    const latencyMs = payload.classifierLatencyMs ?? 0;

    const isMentalHealth = domain === "mental-health";

    const success = await sendSlackMessage({
      userId,
      domain,
      category,
      severity,
      sessionId,
      isMentalHealth,
      classifier,
      latencyMs,
    });

    return res.json({
      status: success ? "delivered" : "error",
      channel: "slack",
    });
  } catch (err: any) {
    console.error("Relay processing error:", err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.RELAY_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n📲 SigNoz → Slack Webhook Relay running on http://localhost:${PORT}`);
  console.log(`Listening for alert POST requests at /alert`);
});
