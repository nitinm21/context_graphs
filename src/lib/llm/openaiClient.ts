import { getLlmConfig } from './config';

type JsonObject = Record<string, unknown>;

export type OpenAITextGenerationRequest = {
  systemPrompt: string;
  userPrompt: string;
  purpose: 'answer_synthesis' | 'event_review';
};

export type OpenAITextGenerationResult =
  | {
      ok: true;
      text: string;
      model: string;
      responseId: string | null;
      rawUsage?: unknown;
    }
  | {
      ok: false;
      error: string;
      statusCode?: number;
      model: string;
    };

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function extractTextFromResponsesApi(payload: unknown): string | null {
  const obj = asObject(payload);
  const outputText = asString(obj.output_text);
  if (outputText && outputText.trim()) return outputText.trim();

  const output = Array.isArray(obj.output) ? obj.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    const itemObj = asObject(item);
    const content = Array.isArray(itemObj.content) ? itemObj.content : [];
    for (const part of content) {
      const partObj = asObject(part);
      const directText = asString(partObj.text);
      if (directText && directText.trim()) chunks.push(directText.trim());
      const nestedText = asString(asObject(partObj.output_text).text);
      if (nestedText && nestedText.trim()) chunks.push(nestedText.trim());
    }
  }
  if (chunks.length) return chunks.join('\n').trim();

  const choices = Array.isArray(obj.choices) ? obj.choices : [];
  const firstChoice = choices[0];
  const message = asObject(asObject(firstChoice).message);
  const content = message.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const parts = content
      .map((part) => asString(asObject(part).text))
      .filter((text): text is string => Boolean(text && text.trim()))
      .map((text) => text.trim());
    if (parts.length) return parts.join('\n').trim();
  }

  return null;
}

function buildErrorMessage(statusCode: number, payload: unknown): string {
  const obj = asObject(payload);
  const errorObj = asObject(obj.error);
  const message = asString(errorObj.message) ?? asString(obj.message);
  return message ? `OpenAI API ${statusCode}: ${message}` : `OpenAI API ${statusCode} returned an error`;
}

export async function generateOpenAIText(request: OpenAITextGenerationRequest): Promise<OpenAITextGenerationResult> {
  const cfg = getLlmConfig();
  const model = cfg.model;
  if (!cfg.apiKey) {
    return { ok: false, error: 'OPENAI_API_KEY is missing', model };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  const endpoint = `${cfg.baseUrl}/responses`;

  const body = {
    model: cfg.model,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: request.systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: request.userPrompt }],
      },
    ],
    temperature: cfg.synthesisTemperature,
    max_output_tokens: cfg.maxOutputTokens,
    metadata: {
      app: 'irishman-narrative-trace-explorer',
      purpose: request.purpose,
      phase: 'phase7',
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    let payload: unknown = {};
    try {
      payload = text ? (JSON.parse(text) as unknown) : {};
    } catch {
      payload = { raw_text: text };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: buildErrorMessage(response.status, payload),
        statusCode: response.status,
        model,
      };
    }

    const synthesized = extractTextFromResponsesApi(payload);
    if (!synthesized) {
      return {
        ok: false,
        error: 'OpenAI response did not contain readable text output',
        statusCode: response.status,
        model,
      };
    }

    const obj = asObject(payload);
    return {
      ok: true,
      text: synthesized,
      model: asString(obj.model) ?? model,
      responseId: asString(obj.id),
      rawUsage: obj.usage,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: `OpenAI request timed out after ${cfg.timeoutMs}ms`, model };
    }
    const message = error instanceof Error ? error.message : 'Unknown OpenAI client error';
    return { ok: false, error: message, model };
  } finally {
    clearTimeout(timeout);
  }
}
