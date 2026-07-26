/**
 * SigNoz API-Powered Slack Forensic Bot
 *
 * Allows on-call engineers to ask natural language questions in Slack
 * about GuardrailOps traces and metrics, powered by SigNoz HTTP API.
 */

/// <reference types="node" />
import express from "express";

const app = express();
app.use(express.json());

const signozUrl = process.env.SIGNOZ_URL || "http://localhost:8080";
const signozApiKey = process.env.SIGNOZ_API_KEY || "";
const PORT = process.env.SLACK_BOT_PORT || 3002;

/**
 * Execute a SigNoz query range for traces
 */
async function querySigNozTraces(filterExpression: string, limit = 100) {
  const now = Date.now();
  const start = now - (24 * 60 * 60 * 1000); // 24 hours

  const body = {
    schemaVersion: "v1",
    start,
    end: now,
    requestType: "raw",
    compositeQuery: {
      queries: [
        {
          type: "builder_query",
          spec: {
            name: "A",
            signal: "traces",
            stepInterval: 60,
            disabled: false,
            filter: filterExpression ? { expression: filterExpression } : undefined,
            limit,
            offset: 0,
            order: [{ key: { name: "timestamp" }, direction: "desc" }]
          }
        }
      ]
    }
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signozApiKey) {
    headers["SIGNOZ-API-KEY"] = signozApiKey;
  }

  const response = await fetch(`${signozUrl}/api/v5/query_range`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    console.error(`SigNoz API Error: ${response.status} ${response.statusText}`);
    return null;
  }
  return response.json();
}

/**
 * Handle Slash commands & messages from Slack
 */
app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  if (type === "url_verification") {
    return res.json({ challenge });
  }

  if (event && event.type === "app_mention") {
    const text = event.text || "";
    console.log(`[SLACK INCOMING MENTION]: "${text}" from User ${event.user}`);

    let replyText = "";

    try {
      if (text.toLowerCase().includes("session") || text.toLowerCase().includes("trace")) {
        const sessionMatch = text.match(/sess_[a-zA-Z0-9_]+/);
        const sessionId = sessionMatch ? sessionMatch[0] : null;

        if (!sessionId) {
          replyText = `⚠️ Please provide a valid session ID (e.g., sess_demo_100).`;
        } else {
          // Query SigNoz for this session
          const data = await querySigNozTraces(`guardrail.session_id = '${sessionId}'`);
          const traces = data?.data?.result?.[0]?.list || [];
          
          if (traces.length === 0) {
            replyText = `🔍 No traces found for session \`${sessionId}\` in the last 24h.`;
          } else {
            // Find the most severe classification
            const blocks = traces.filter((t: any) => t.data?.['guardrail.action'] === 'BLOCK');
            const traceToReport = blocks.length > 0 ? blocks[0] : traces[0];
            const tData = traceToReport.data || {};
            
            replyText = `📋 *Forensic Trace Summary via SigNoz API*\n` +
              `• *Session ID:* \`${tData['guardrail.session_id'] || sessionId}\`\n` +
              `• *Domain:* ${tData['guardrail.domain'] || 'unknown'}\n` +
              `• *Category:* ${tData['guardrail.category'] || 'unknown'}\n` +
              `• *Severity:* ${tData['guardrail.severity'] || 'NONE'}\n` +
              `• *Action:* ${tData['guardrail.action'] === 'BLOCK' ? '🔴 BLOCKED' : '✅ ALLOWED'}\n` +
              `• *Classifier:* ${tData['guardrail.classifier'] || 'unknown'} (${tData['guardrail.classifier.latency_ms'] || 0}ms)\n` +
              `• *User Threat Score:* ${tData['guardrail.user.threat_score'] || 0} (Status: ${tData['guardrail.user.status'] || 'NORMAL'})\n` +
              `• *Trace ID:* \`<http://localhost:3301/trace/${traceToReport.traceID}|${traceToReport.traceID}>\`\n` +
              `_Live Data pulled from SigNoz HTTP API_`;
          }
        }
      } else if (text.toLowerCase().includes("crises") || text.toLowerCase().includes("summary") || text.toLowerCase().includes("today")) {
        // Query SigNoz for all GuardrailOps traces today
        const data = await querySigNozTraces(`guardrail.action EXISTS`, 1000);
        const traces = data?.data?.result?.[0]?.list || [];
        
        if (traces.length === 0) {
          replyText = `📊 *24-Hour Guardrail Ops Summary*\nNo incidents observed in the last 24h.`;
        } else {
          const blocks = traces.filter((t: any) => t.data?.['guardrail.action'] === 'BLOCK');
          const criticals = traces.filter((t: any) => t.data?.['guardrail.severity'] === 'CRITICAL');
          const highs = traces.filter((t: any) => t.data?.['guardrail.severity'] === 'HIGH');
          
          replyText = `📊 *24-Hour Guardrail Ops Summary*\n` +
            `• *Total Traces Observed:* ${traces.length}\n` +
            `• *Blocked Requests:* ${blocks.length} (${((blocks.length / traces.length) * 100).toFixed(1)}% block rate)\n` +
            `• *CRITICAL Events:* ${criticals.length}\n` +
            `• *HIGH Events:* ${highs.length}\n` +
            `_Live Data pulled from SigNoz HTTP API_`;
        }
      } else {
        replyText = `👋 *GuardrailOps Slack Assistant*\n\n` +
          `Ask me questions about safety incidents (LIVE powered by SigNoz API):\n` +
          `• \`@GuardrailOpsBot show trace for session sess_demo_100\`\n` +
          `• \`@GuardrailOpsBot summary of today\``;
      }
    } catch (e) {
      console.error(e);
      replyText = `❌ Error connecting to SigNoz API. Ensure it is running at ${signozUrl}.`;
    }

    return res.json({ text: replyText });
  }

  return res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`🤖 GuardrailOps Slack Bot listening on http://localhost:${PORT}`);
});
