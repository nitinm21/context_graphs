export type QueryType = 'fact' | 'timeline' | 'state_change' | 'causal_chain' | 'evidence' | 'comparison';

export type AnswerMode = 'kg' | 'ntg' | 'hybrid' | 'baseline_rag';

export type PreferredMode = 'auto' | 'kg' | 'ntg' | 'hybrid' | 'baseline_rag' | 'baseline';

export type QueryRequest = {
  question: string;
  preferredMode: PreferredMode;
  includeEvidence: boolean;
  includeBaselineComparison: boolean;
};

export type StructuredAnswerCore = {
  answerText: string;
  modeUsed: AnswerMode;
  queryType: QueryType;
  confidence: number;
  entitiesUsed: string[];
  eventsUsed: string[];
  stateChangesUsed: string[];
  evidenceRefs: string[];
  reasoningNotes: string;
};

export type QueryResponse = StructuredAnswerCore & {
  question: string;
  baselineComparison: StructuredAnswerCore | null;
};

type ApiAnswerPayload = {
  query_type: QueryType;
  mode_used: AnswerMode;
  answer_text: string;
  confidence: number;
  entities_used: string[];
  events_used: string[];
  state_changes_used: string[];
  evidence_refs: string[];
  reasoning_notes: string;
};

export type ApiQueryResponse = ApiAnswerPayload & {
  question: string;
  baseline_comparison: ApiAnswerPayload | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length === value.length ? items : null;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const v = value.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function normalizeQueryRequest(input: unknown): { ok: true; value: QueryRequest } | { ok: false; error: string } {
  const obj = asObject(input);
  const question = (asString(obj.question) ?? '').trim();
  if (!question) {
    return { ok: false, error: 'Missing non-empty "question" string' };
  }

  const preferredModeRaw = (asString(obj.preferred_mode) ?? asString(obj.preferredMode) ?? 'auto').trim().toLowerCase();
  const preferredMode: PreferredMode = (['auto', 'kg', 'ntg', 'hybrid', 'baseline_rag', 'baseline'].includes(preferredModeRaw)
    ? preferredModeRaw
    : 'auto') as PreferredMode;

  const includeEvidenceRaw = asBoolean(obj.include_evidence) ?? asBoolean(obj.includeEvidence);
  const includeBaselineComparisonRaw =
    asBoolean(obj.include_baseline_comparison) ?? asBoolean(obj.includeBaselineComparison);

  return {
    ok: true,
    value: {
      question,
      preferredMode,
      includeEvidence: includeEvidenceRaw ?? true,
      includeBaselineComparison: includeBaselineComparisonRaw ?? false,
    },
  };
}

export function normalizeStructuredAnswer(input: StructuredAnswerCore): StructuredAnswerCore {
  return {
    answerText: input.answerText.trim(),
    modeUsed: input.modeUsed,
    queryType: input.queryType,
    confidence: clampConfidence(input.confidence),
    entitiesUsed: uniqueStrings(input.entitiesUsed ?? []),
    eventsUsed: uniqueStrings(input.eventsUsed ?? []),
    stateChangesUsed: uniqueStrings(input.stateChangesUsed ?? []),
    evidenceRefs: uniqueStrings(input.evidenceRefs ?? []),
    reasoningNotes: input.reasoningNotes.trim(),
  };
}

function toApiAnswerPayload(answer: StructuredAnswerCore): ApiAnswerPayload {
  const normalized = normalizeStructuredAnswer(answer);
  return {
    query_type: normalized.queryType,
    mode_used: normalized.modeUsed,
    answer_text: normalized.answerText,
    confidence: normalized.confidence,
    entities_used: normalized.entitiesUsed,
    events_used: normalized.eventsUsed,
    state_changes_used: normalized.stateChangesUsed,
    evidence_refs: normalized.evidenceRefs,
    reasoning_notes: normalized.reasoningNotes,
  };
}

export function toApiQueryResponse(response: QueryResponse): ApiQueryResponse {
  return {
    question: response.question,
    ...toApiAnswerPayload(response),
    baseline_comparison: response.baselineComparison ? toApiAnswerPayload(response.baselineComparison) : null,
  };
}

function validateApiAnswerPayload(
  value: unknown,
  options: { allowNull?: boolean } = {},
): { ok: true } | { ok: false; error: string } {
  const allowNull = options.allowNull ?? false;
  if (allowNull && value === null) return { ok: true };
  const obj = asObject(value);
  const queryType = asString(obj.query_type);
  const modeUsed = asString(obj.mode_used);
  const answerText = asString(obj.answer_text);
  const confidence = asFiniteNumber(obj.confidence);
  const entitiesUsed = asStringArray(obj.entities_used);
  const eventsUsed = asStringArray(obj.events_used);
  const stateChangesUsed = asStringArray(obj.state_changes_used);
  const evidenceRefs = asStringArray(obj.evidence_refs);
  const reasoningNotes = asString(obj.reasoning_notes);

  if (!queryType || !['fact', 'timeline', 'state_change', 'causal_chain', 'evidence', 'comparison'].includes(queryType)) {
    return { ok: false, error: 'Invalid query_type' };
  }
  if (!modeUsed || !['kg', 'ntg', 'hybrid', 'baseline_rag'].includes(modeUsed)) {
    return { ok: false, error: 'Invalid mode_used' };
  }
  if (answerText === null) return { ok: false, error: 'Missing answer_text' };
  if (confidence === null || confidence < 0 || confidence > 1) return { ok: false, error: 'Invalid confidence' };
  if (!entitiesUsed) return { ok: false, error: 'Invalid entities_used' };
  if (!eventsUsed) return { ok: false, error: 'Invalid events_used' };
  if (!stateChangesUsed) return { ok: false, error: 'Invalid state_changes_used' };
  if (!evidenceRefs) return { ok: false, error: 'Invalid evidence_refs' };
  if (reasoningNotes === null) return { ok: false, error: 'Missing reasoning_notes' };
  return { ok: true };
}

export function validateApiQueryResponse(value: unknown): { ok: true } | { ok: false; error: string } {
  const obj = asObject(value);
  const question = asString(obj.question);
  if (!question || !question.trim()) {
    return { ok: false, error: 'Missing question' };
  }

  const topLevelValidation = validateApiAnswerPayload(obj);
  if (!topLevelValidation.ok) return topLevelValidation;

  const baselineValidation = validateApiAnswerPayload(obj.baseline_comparison, { allowNull: true });
  if (!baselineValidation.ok) return baselineValidation;

  return { ok: true };
}
