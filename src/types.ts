/**
 * GuardrailOps — Core Type Definitions
 */

// ─── Severity Levels ───
export type Severity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

// ─── Actions the SDK can take ───
export type Action = "ALLOW" | "WARN" | "BLOCK";

// ─── User threat status tiers ───
export type UserStatus = "NORMAL" | "WATCH" | "RESTRICTED" | "BLOCKED";

// ─── Supported threat domains ───
export type Domain =
  | "mental-health"
  | "abuse"
  | "illegal"
  | "jailbreak"
  | "off-topic";

// ─── Classification result from any classifier engine ───
export interface ClassificationResult {
  domain: Domain;
  category: string;
  severity: Severity;
  confidence: number;
  classifier: "llama-guard" | "openai-moderation" | "heuristic-prefilter" | "custom";
  classifierLatencyMs: number;
}

// ─── Per-domain configuration ───
export interface DomainConfig {
  severity: Severity;
  action: Action;
  alert: boolean;
  flagUser: boolean;
  fallbackMessage: string;
  mode?: "strict" | "companion"; // specifically for mental-health domain
}

// ─── Stateful user threat tracking ───
export interface UserThreatState {
  userId: string;
  threatScore: number;
  violationCount: number;
  status: UserStatus;
  lastViolationAt: number | null;
  domains: Record<string, number>; // domain → count
}

// ─── Scoring result after classification ───
export interface ScoringResult {
  classification: ClassificationResult;
  action: Action;
  pushAlert: boolean;
  fallbackMessage: string | null;
}

// ─── Event hooks ───
export interface GuardrailOpsHooks {
  onBlock?: (event: GuardrailEvent) => void | Promise<void>;
  onFlag?: (event: GuardrailEvent) => void | Promise<void>;
  onClassify?: (event: GuardrailEvent) => void | Promise<void>;
  onAlert?: (event: GuardrailEvent) => void | Promise<void>;
}

// ─── Full event emitted on every classification ───
export interface GuardrailEvent {
  timestamp: number;
  sessionId: string;
  userId: string;
  domain: Domain;
  category: string;
  severity: Severity;
  action: Action;
  pushAlert: boolean;
  blocked: boolean;
  fallbackShown: boolean;
  fallbackMessage: string | null;
  classifierLatencyMs: number;
  classifier: string;
}

// ─── Custom classifier function signature ───
export type CustomClassifyFn = (
  message: string
) => Promise<ClassificationResult | null>;

// ─── Llama Guard 3 configuration ───
export interface LlamaGuardConfig {
  /**
   * Endpoint URL.
   * - Local Ollama: "http://localhost:11434" (default)
   * - Cloud Hosted: "https://api.together.xyz/v1" or "https://api.fireworks.ai/inference/v1"
   */
  endpoint?: string;

  /**
   * Model name.
   * - Local Ollama: "llama-guard3:1b" (default) or "llama-guard3:8b"
   * - Cloud Hosted: "meta-llama/Meta-Llama-Guard-3-8B" or "accounts/fireworks/models/llama-guard-3-8b"
   */
  model?: string;

  /** API Key (required for cloud-hosted Llama Guard providers like Together AI, Fireworks AI, Groq, vLLM) */
  apiKey?: string;

  /**
   * Provider mode.
   * - "auto" (default): Auto-detects based on endpoint URL / presence of apiKey
   * - "ollama": Local Ollama API
   * - "openai-compatible": Cloud-hosted REST API (Together AI, Fireworks, vLLM, custom cloud deployment)
   */
  provider?: "auto" | "ollama" | "openai-compatible";
}

// ─── Main SDK configuration ───
export interface GuardrailOpsConfig {
  /** Which threat domains to enable */
  domains: Domain[];

  /** Per-domain configuration overrides */
  domainConfig?: Partial<Record<Domain, Partial<DomainConfig>>>;

  /** OpenTelemetry configuration */
  otel?: {
    serviceName?: string;
    exporterEndpoint?: string;
    enabled?: boolean;
  };

  /** Webhook URL for Slack push alerts */
  alertWebhook?: string;

  /** Function to extract user ID from the request */
  getUserId?: (messages: unknown[]) => string;

  /** Function to extract session ID from the request */
  getSessionId?: (messages: unknown[]) => string;

  /**
   * Primary ML classifier backend.
   * - "auto" (default): Tries llama-guard → openai-moderation → heuristic-only
   * - "llama-guard": Use Llama Guard 3 via Ollama (free, local, private)
   * - "openai-moderation": Use OpenAI omni-moderation-latest (free, requires API credit)
   * - "custom": Use a user-provided classifyFn
   */
  classifier?: "auto" | "llama-guard" | "openai-moderation" | "custom";

  /** Llama Guard 3 configuration (endpoint, model name) */
  llamaGuard?: LlamaGuardConfig;

  /** Custom classifier function (required when classifier = "custom") */
  classifyFn?: CustomClassifyFn;

  /** OpenAI API key (for moderation API — free, separate from chat) */
  openaiApiKey?: string;

  /** Event hooks */
  hooks?: GuardrailOpsHooks;
}
