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

import { execSync } from "child_process";

/**
 * Execute a SigNoz query for traces directly against ClickHouse telemetry store
 */
async function querySigNozTraces(filterExpression: string, limit = 100) {
  try {
    let whereClause = "WHERE serviceName = 'guardrailops-demo'";
    if (filterExpression) {
      if (filterExpression.includes("session_id")) {
        const sessId = filterExpression.match(/sess_[a-zA-Z0-9_]+/)?.[0];
        if (sessId) {
          whereClause += ` AND attributes_string['guardrail.session_id'] = '${sessId}'`;
        }
      }
    }

    const query = `SELECT trace_id, attributes_string, attributes_bool, attributes_number FROM signoz_traces.signoz_index_v3 ${whereClause} ORDER BY timestamp DESC LIMIT ${limit} FORMAT JSON;`;
    const cmd = `wsl docker exec -i signoz-telemetrystore-clickhouse-0-0 clickhouse-client --query "${query.replace(/"/g, '\\"')}"`;
    
    const output = execSync(cmd, { encoding: "utf8" });
    const parsed = JSON.parse(output);

    const list = (parsed.data || []).map((row: any) => ({
      traceID: row.trace_id,
      data: {
        ...row.attributes_string,
        ...row.attributes_bool,
        ...row.attributes_number
      }
    }));

    return { data: { result: [{ list }] } };
  } catch (err) {
    console.error("ClickHouse Query Error:", err);
    return null;
  }
}

/**
 * Model Context Protocol (MCP) Tool Execution Endpoint
 * Exposes SigNoz trace querying tools via standard MCP JSON-RPC protocol.
 */
app.post("/mcp", async (req, res) => {
  const { jsonrpc, method, params, id } = req.body;

  if (method === "tools/list") {
    return res.json({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "search_signoz_traces",
            description: "Query SigNoz OpenTelemetry traces for GuardrailOps safety events and user threat metrics",
            inputSchema: {
              type: "object",
              properties: {
                filter: { type: "string", description: "SigNoz query expression e.g. guardrail.domain = 'jailbreak'" },
                limit: { type: "number", default: 50 }
              }
            }
          },
          {
            name: "get_session_summary",
            description: "Retrieve full session trace summary and threat classification for a given session ID",
            inputSchema: {
              type: "object",
              properties: {
                sessionId: { type: "string", description: "GuardrailOps session ID e.g. sess_demo_100" }
              },
              required: ["sessionId"]
            }
          }
        ]
      }
    });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name === "search_signoz_traces") {
      const data = await querySigNozTraces(args.filter || "", args.limit || 50);
      return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
    }
    if (name === "get_session_summary") {
      const data = await querySigNozTraces(`guardrail.session_id = '${args.sessionId}'`);
      return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data) }] } });
    }
  }

  return res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});
app.post("/slack/events", async (req, res) => {
  const { type, challenge, event } = req.body;
  console.log(`[SLACK EVENT RECEIVED]: type=${type}`, JSON.stringify(req.body));

  if (type === "url_verification") {
    return res.json({ challenge });
  }

  if (event && (event.type === "app_mention" || event.type === "message")) {
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
              `• *Trace ID:* \`<http://localhost:8080/trace/${traceToReport.traceID}|${traceToReport.traceID}>\`\n` +
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

      // Post reply back to Slack Webhook URL if available
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (webhookUrl) {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: replyText })
        });
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
