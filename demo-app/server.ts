/**
 * MindBot Demo Application Server
 * Express.js backend using GuardrailOps SDK wrapper
 */

/// <reference types="node" />
import fs from "node:fs";

if (fs.existsSync(".env")) {
  const lines = fs.readFileSync(".env", "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const [key, ...vals] = trimmed.split("=");
      const k = key.trim();
      if (k && !process.env[k]) {
        process.env[k] = vals.join("=").trim();
      }
    }
  }
}
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { wrapWithGuardrailOps } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Mock LLM Client mimicking standard chat completions structure for self-contained demonstration
class MockLLMClient {
  chat = {
    completions: {
      create: async (params: { messages: Array<{ role: string; content: string }> }) => {
        const lastMsg = params.messages[params.messages.length - 1]?.content ?? "";
        return {
          id: "chatcmpl-demo-123",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "generic-llm-v1",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: `Hello! I received your message ("${lastMsg}"). GuardrailOps scanned your input in real-time, verified 0 threat violations, and allowed this response.`,
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 18, total_tokens: 30 },
        };
      },
    },
  };
}

const rawLLMClient = new MockLLMClient();

// Protect LLM client with GuardrailOps SDK!
const protectedClient = wrapWithGuardrailOps(rawLLMClient, {
  domains: ["mental-health", "abuse", "illegal", "jailbreak", "off-topic"],
  domainConfig: {
    "mental-health": {
      mode: "companion", // Showcase P1: Distinguishes general distress (ALLOW) vs imminent crisis (BLOCK)
    },
  },
  classifier: "auto", // Uses Llama Guard 3 local → Heuristic fallback
  llamaGuard: {
    endpoint: "http://localhost:11434",
    model: "llama-guard3:1b",
  },
  alertWebhook: "http://localhost:3001/alert",
  hooks: {
    onBlock: (event) => {
      console.log(`[GUARDRAIL BLOCKED]: ${event.domain} / ${event.category} via ${event.classifier} (${event.classifierLatencyMs}ms) (User: ${event.userId})`);
    },
    onAlert: async (event) => {
      console.log(`[PUSH ALERT FIRED]: ${event.domain} / ${event.category} -> Slack Webhook Relay (port 3001)`);
      try {
        await fetch("http://localhost:3001/alert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        });
      } catch (err) {
        console.error("Alert relay error:", err);
      }
    },
  },
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, userId, sessionId } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response: any = await protectedClient.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are MindBot, a supportive AI assistant." },
        { role: "user", content: message },
      ],
      user: userId || "sarah.connor@acme.com",
    });

    const isBlocked = (response as any)._guardrailops?.blocked === true;
    const metadata = (response as any)._guardrailops ?? null;

    return res.json({
      reply: response.choices[0].message.content,
      blocked: isBlocked,
      metadata,
    });
  } catch (err: any) {
    console.error("Chat API error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🧠 MindBot Demo Server running on http://localhost:${PORT}`);
  console.log(`🛡️ GuardrailOps Active with 5 Threat Domains & OTel Telemetry`);
});
