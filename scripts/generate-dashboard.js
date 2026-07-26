import fs from "fs";
import { execSync } from "child_process";

const dashboard = {
  title: "GuardrailOps — AI Safety & Crisis Overview",
  description: "SigNoz dashboard monitoring AI safety events, jailbreak attempts, PII redaction, and repeat attacker trace counts captured by GuardrailOps SDK.",
  tags: ["guardrailops", "ai-safety", "opentelemetry", "jailbreak"],
  version: "v3",
  layout: [
    { i: "panel-1-crisis-counter", x: 0, y: 0, w: 6, h: 4 },
    { i: "panel-2-severity-pie", x: 6, y: 0, w: 6, h: 4 },
    { i: "panel-3-domain-bar", x: 0, y: 4, w: 6, h: 4 },
    { i: "panel-4-latency-p99", x: 6, y: 4, w: 6, h: 4 },
    { i: "panel-6-category-pie", x: 0, y: 8, w: 6, h: 4 },
    { i: "panel-7-classifier-pie", x: 6, y: 8, w: 6, h: 4 },
    { i: "panel-5-flagged-users", x: 0, y: 12, w: 12, h: 6 }
  ],
  widgets: [
    {
      id: "panel-1-crisis-counter",
      title: "🚨 Total Safety Events (24h)",
      panelTypes: "value",
      query: {
        queryType: "builder",
        builder: {
          queryData: [
            {
              queryName: "A",
              dataSource: "traces",
              disabled: false,
              expression: "A",
              aggregations: [{ expression: "count() " }],
              filter: { expression: "serviceName = 'guardrailops-demo'" },
              groupBy: [],
              functions: [],
              having: { expression: "" },
              legend: "Total Events",
              orderBy: [],
              limit: null,
              stepInterval: null
            }
          ],
          queryFormulas: [],
          queryTraceOperator: []
        }
      }
    },
    {
      id: "panel-2-severity-pie",
      title: "📊 Crisis Severity Breakdown",
      panelTypes: "pie",
      query: {
        queryType: "builder",
        builder: {
          queryData: [
            {
              queryName: "A",
              dataSource: "traces",
              disabled: false,
              expression: "A",
              aggregations: [{ expression: "count() " }],
              filter: { expression: "serviceName = 'guardrailops-demo'" },
              groupBy: [
                {
                  dataType: "string",
                  id: "guardrail.crisis.severity--string--tag",
                  isColumn: false,
                  isJSON: false,
                  key: "guardrail.crisis.severity",
                  type: "tag"
                }
              ],
              functions: [],
              having: { expression: "" },
              legend: "{{guardrail.crisis.severity}}",
              orderBy: [],
              limit: null,
              stepInterval: null
            }
          ],
          queryFormulas: [],
          queryTraceOperator: []
        }
      }
    },
    {
      id: "panel-3-domain-bar",
      title: "🛡️ Threat Domain Hit Rate",
      panelTypes: "bar",
      query: {
        queryType: "builder",
        builder: {
          queryData: [
            {
              queryName: "A",
              dataSource: "traces",
              disabled: false,
              expression: "A",
              aggregations: [{ expression: "count() " }],
              filter: { expression: "serviceName = 'guardrailops-demo'" },
              groupBy: [
                {
                  dataType: "string",
                  id: "guardrail.domain--string--tag",
                  isColumn: false,
                  isJSON: false,
                  key: "guardrail.domain",
                  type: "tag"
                }
              ],
              functions: [],
              having: { expression: "" },
              legend: "{{guardrail.domain}}",
              orderBy: [],
              limit: null,
              stepInterval: null
            }
          ],
          queryFormulas: [],
          queryTraceOperator: []
        }
      }
    },
    {
      id: "panel-4-latency-p99",
      title: "⚡ Classifier Latency (p99)",
      panelTypes: "timeSeries",
      query: {
        queryType: "builder",
        builder: {
          queryData: [
            {
              queryName: "A",
              dataSource: "traces",
              disabled: false,
              expression: "A",
              aggregations: [{ expression: "quantile(0.99)(guardrail.classifier.latency_ms) " }],
              filter: { expression: "serviceName = 'guardrailops-demo'" },
              groupBy: [],
              functions: [],
              having: { expression: "" },
              legend: "Latency p99 (ms)",
              orderBy: [],
              limit: null,
              stepInterval: null
            }
          ],
          queryFormulas: [],
          queryTraceOperator: []
        }
      }
    },
    {
      id: "panel-6-category-pie",
      title: "🧩 Safety Violation Categories (Pie)",
      panelTypes: "pie",
      query: {
        queryType: "builder",
        builder: {
          queryData: [
            {
              queryName: "A",
              dataSource: "traces",
              disabled: false,
              expression: "A",
              aggregations: [{ expression: "count() " }],
              filter: { expression: "serviceName = 'guardrailops-demo'" },
              groupBy: [
                {
                  dataType: "string",
                  id: "guardrail.category--string--tag",
                  isColumn: false,
                  isJSON: false,
                  key: "guardrail.category",
                  type: "tag"
                }
              ],
              functions: [],
              having: { expression: "" },
              legend: "{{guardrail.category}}",
              orderBy: [],
              limit: null,
              stepInterval: null
            }
          ],
          queryFormulas: [],
          queryTraceOperator: []
        }
      }
    },
    {
      id: "panel-7-classifier-pie",
      title: "🤖 Guardrail Engine Trigger Distribution (Pie)",
      panelTypes: "pie",
      query: {
        queryType: "builder",
        builder: {
          queryData: [
            {
              queryName: "A",
              dataSource: "traces",
              disabled: false,
              expression: "A",
              aggregations: [{ expression: "count() " }],
              filter: { expression: "serviceName = 'guardrailops-demo'" },
              groupBy: [
                {
                  dataType: "string",
                  id: "guardrail.classifier--string--tag",
                  isColumn: false,
                  isJSON: false,
                  key: "guardrail.classifier",
                  type: "tag"
                }
              ],
              functions: [],
              having: { expression: "" },
              legend: "{{guardrail.classifier}}",
              orderBy: [],
              limit: null,
              stepInterval: null
            }
          ],
          queryFormulas: [],
          queryTraceOperator: []
        }
      }
    },
    {
      id: "panel-5-flagged-users",
      title: "👤 Top Repeat Attacker Users (Blocked Count)",
      panelTypes: "table",
      query: {
        queryType: "builder",
        builder: {
          queryData: [
            {
              queryName: "A",
              dataSource: "traces",
              disabled: false,
              expression: "A",
              aggregations: [{ expression: "count() " }],
              filter: { expression: "serviceName = 'guardrailops-demo' AND guardrail.action = 'BLOCK'" },
              groupBy: [
                {
                  dataType: "string",
                  id: "guardrail.user.id--string--tag",
                  isColumn: false,
                  isJSON: false,
                  key: "guardrail.user.id",
                  type: "tag"
                }
              ],
              functions: [],
              having: { expression: "" },
              legend: "{{guardrail.user.id}}",
              orderBy: [],
              limit: null,
              stepInterval: null
            }
          ],
          queryFormulas: [],
          queryTraceOperator: []
        }
      }
    }
  ]
};

fs.writeFileSync("dashboard.json", JSON.stringify(dashboard, null, 2));
console.log("Generated valid dashboard.json with legends!");

const escapedJson = JSON.stringify(dashboard).replace(/'/g, "''");

const sql = `
INSERT INTO dashboard (id, created_at, updated_at, created_by, updated_by, data, locked, org_id, source, name)
VALUES (
  '019f6abb-0000-4000-8000-000000000001',
  NOW(),
  NOW(),
  '019f6abb-aa17-7aa0-8cd8-fbcb6ed00695',
  '019f6abb-aa17-7aa0-8cd8-fbcb6ed00695',
  '${escapedJson}',
  false,
  '019f6abb-aa17-7a8b-b2ef-46da39535d3c',
  'user',
  'GuardrailOps — AI Safety & Crisis Overview'
)
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW();
`;

fs.writeFileSync("seed-dashboard.sql", sql);

try {
  execSync('wsl bash -c "cat /mnt/e/guardrailops/seed-dashboard.sql | docker exec -i signoz-metastore-postgres-0 psql -U signoz -d signoz"', { stdio: 'inherit' });
  console.log("✅ Dashboard successfully seeded into SigNoz!");
} catch (err) {
  console.error("Seeding error:", err);
}
