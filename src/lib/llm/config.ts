export type LlmConfig = {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxOutputTokens: number;
  synthesisTemperature: number;
  enableLlmSynthesisFlag: boolean;
  enableLlmEventReviewFlag: boolean;
};

export type LlmSynthesisStatus = {
  enabled: boolean;
  hasApiKey: boolean;
  model: string;
  baseUrl: string;
  reason: string;
  timeoutMs: number;
  maxOutputTokens: number;
};

let llmConfigCache: LlmConfig | null = null;

function parseBoolean(raw: string | undefined, fallback = false): boolean {
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseFloatNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || !raw.trim()) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeBaseUrl(input: string | undefined): string {
  const raw = (input ?? 'https://api.openai.com/v1').trim();
  if (!raw) return 'https://api.openai.com/v1';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function readConfigUncached(): LlmConfig {
  const apiKeyRaw = (process.env.OPENAI_API_KEY ?? '').trim();
  return {
    apiKey: apiKeyRaw || null,
    model: (process.env.OPENAI_MODEL ?? 'gpt-4.1-mini').trim() || 'gpt-4.1-mini',
    baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL),
    timeoutMs: parseInteger(process.env.OPENAI_TIMEOUT_MS, 15000, 1000, 120000),
    maxOutputTokens: parseInteger(process.env.OPENAI_MAX_OUTPUT_TOKENS, 500, 64, 4000),
    synthesisTemperature: parseFloatNumber(process.env.OPENAI_SYNTHESIS_TEMPERATURE, 0.2, 0, 1.5),
    enableLlmSynthesisFlag: parseBoolean(process.env.ENABLE_LLM_SYNTHESIS, false),
    enableLlmEventReviewFlag: parseBoolean(process.env.ENABLE_LLM_EVENT_REVIEW, false),
  };
}

export function invalidateLlmConfigCache(): void {
  llmConfigCache = null;
}

export function getLlmConfig(): LlmConfig {
  if (!llmConfigCache) {
    llmConfigCache = readConfigUncached();
  }
  return llmConfigCache;
}

export function getLlmSynthesisStatus(): LlmSynthesisStatus {
  const cfg = getLlmConfig();
  const hasApiKey = Boolean(cfg.apiKey);
  if (!cfg.enableLlmSynthesisFlag) {
    return {
      enabled: false,
      hasApiKey,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      reason: 'ENABLE_LLM_SYNTHESIS is disabled',
      timeoutMs: cfg.timeoutMs,
      maxOutputTokens: cfg.maxOutputTokens,
    };
  }
  if (!hasApiKey) {
    return {
      enabled: false,
      hasApiKey,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      reason: 'OPENAI_API_KEY is missing',
      timeoutMs: cfg.timeoutMs,
      maxOutputTokens: cfg.maxOutputTokens,
    };
  }
  return {
    enabled: true,
    hasApiKey,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    reason: 'LLM synthesis enabled',
    timeoutMs: cfg.timeoutMs,
    maxOutputTokens: cfg.maxOutputTokens,
  };
}

export function getLlmEventReviewEnabled(): boolean {
  const cfg = getLlmConfig();
  return cfg.enableLlmEventReviewFlag && Boolean(cfg.apiKey);
}
