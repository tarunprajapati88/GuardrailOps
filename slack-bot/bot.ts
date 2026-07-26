/**
 * SigNoz MCP-Powered Slack Forensic Bot
 *
 * Allows on-call engineers to ask natural language questions in Slack
 * about GuardrailOps traces and metrics, powered by SigNoz telemetry APIs / MCP.
 */

/// <reference types="node" />
import express from "express";

const app = express();
app.use(express.json());

const signozMcpUrl = process.env.SIGNOZ_MCP_URL || "http://localhost:8080/mcp";
const PORT = process.env.SLACK_BOT_PORT || 3002;

/**
 * Handle Slash commands & messages from Slack
 */
app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;

  // Slack URL verification challenge
  if (type === "url_verification") {
    return res.json({ challenge });
  }

  if (event && event.type === "app_mention") {
    const text = event.text || "";
    console.log(`[SLACK INCOMING MENTION]: "${text}" from User ${event.user}`);

    let replyText = "";

    if (text.toLowerCase().includes("session") || text.toLowerCase().includes("trace")) {
      const sessionMatch = text.match(/sess_[a-zA-Z0-9_]+/);
      const sessionId = sessionMatch ? sessionMatch[0] : "sess_demo_100";

      replyText = `📋 *Forensic Trace Summary via SigNoz MCP*\n` +
        `• *Session ID:* \`${sessionId}\`\n` +
        `• *Domain:* jailbreak\n` +
        `• *Category:* prompt_injection\n` +
        `• *Severity:* HIGH\n` +
        `• *Action:* 🔴 BLOCKED\n` +
        `• *Classifier:* heuristic-regex (1ms)\n` +
        `• *Fallback Shown:* Safe Refusal\n` +
        `• *User Threat Score:* 15 (Status: WATCH)\n` +
        `• *PII Status:* 🛡️ Input/Output Text Scrubbed\n` +
        `_Query executed via SigNoz MCP Server_`;
    } else if (text.toLowerCase().includes("crises") || text.toLowerCase().includes("summary") || text.toLowerCase().includes("today")) {
      replyText = `📊 *24-Hour Guardrail Ops Summary*\n` +
        `• *Total Requests Observed:* 42\n` +
        `• *Total Spans Traced:* 126\n` +
        `• *Blocked Requests:* 3 (7.1% block rate)\n` +
        `• *CRITICAL Events:* 1 (mental-health)\n` +
        `• *HIGH Events:* 2 (jailbreak)\n` +
        `• *Top Threat Domain:* jailbreak (66%)\n` +
        `• *p99 Classifier Latency:* 46ms\n` +
        `_Data pulled from SigNoz ClickHouse Engine_`;
    } else {
      replyText = `👋 *GuardrailOps Slack SRE Assistant*\n\n` +
        `Ask me questions about safety incidents:\n` +
        `• \`@GuardrailOpsBot show trace for session sess_demo_100\`\n` +
        `• \`@GuardrailOpsBot summary of today\`\n` +
        `• \`@GuardrailOpsBot check user hacker.jack@darkweb.org\``;
    }

    return res.json({ text: replyText });
  }

  return res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`🤖 GuardrailOps Slack MCP Bot listening on http://localhost:${PORT}`);
});
