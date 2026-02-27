import { loadKgArtifacts } from './kgData';
import type { QueryRequest, QueryResponse, StructuredAnswerCore } from './queryContract';
import { normalizeStructuredAnswer } from './queryContract';
import { routeQuery } from './queryRouter';
import { buildBaselineRagLikeAnswer } from './answers/baselineRagLike';
import { buildHybridAnswer } from './answers/hybridAnswer';
import { buildKgAnswer } from './answers/kgAnswer';
import { maybeSynthesizeStructuredAnswerWithLLM } from './answers/synthesizeWithLLM';
import { buildTraceAnswer } from './answers/traceAnswer';
import type { AnswerBuilderContext, DetectedEntityMention } from './answers/shared';

type EntityDetectionLexiconEntry = {
  entityId: string;
  canonicalName: string;
  entityType: string;
  phrase: string;
  matchKind: 'canonical' | 'alias' | 'hint';
  priority: number;
};

type EntityDetectionLexicon = {
  entries: EntityDetectionLexiconEntry[];
  entityById: Map<string, { canonicalName: string; entityType: string }>;
};

let entityLexiconCache: Promise<EntityDetectionLexicon> | null = null;

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
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

async function buildEntityDetectionLexicon(): Promise<EntityDetectionLexicon> {
  const kg = await loadKgArtifacts();
  if (!kg.available) {
    return { entries: [], entityById: new Map() };
  }

  const entityById = new Map<string, { canonicalName: string; entityType: string }>();
  for (const entity of kg.entities) {
    entityById.set(entity.entityId, { canonicalName: entity.canonicalName, entityType: entity.entityType });
  }

  const entries: EntityDetectionLexiconEntry[] = [];
  const seen = new Set<string>();
  const addEntry = (
    entityId: string,
    canonicalName: string,
    entityType: string,
    phraseRaw: string,
    matchKind: EntityDetectionLexiconEntry['matchKind'],
    priority: number,
  ) => {
    const phrase = normalizeText(phraseRaw);
    if (!phrase || phrase.length < 3) return;
    const key = `${entityId}|${phrase}|${matchKind}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ entityId, canonicalName, entityType, phrase, matchKind, priority });
  };

  // Canonical names are the primary, safest signal.
  for (const entity of kg.entities) {
    addEntry(entity.entityId, entity.canonicalName, entity.entityType, entity.canonicalName, 'canonical', 100);
  }

  // Manual aliases are useful and much less noisy than screenplay cue aliases.
  for (const alias of kg.aliases) {
    if (!alias.source.toLowerCase().includes('manual')) continue;
    const entityInfo = entityById.get(alias.entityId);
    if (!entityInfo) continue;
    addEntry(alias.entityId, entityInfo.canonicalName, entityInfo.entityType, alias.aliasRaw, 'alias', 80);
    addEntry(alias.entityId, entityInfo.canonicalName, entityInfo.entityType, alias.aliasNormalized, 'alias', 75);
  }

  // Query-friendly hints for the core demo entities and common asks.
  const manualHints: Array<[string, string]> = [
    ['char_frank_sheeran', 'frank sheeran'],
    ['char_frank_sheeran', 'frank'],
    ['char_peggy_sheeran', 'peggy sheeran'],
    ['char_peggy_sheeran', 'peggy'],
    ['char_jimmy_hoffa', 'jimmy hoffa'],
    ['char_jimmy_hoffa', 'hoffa'],
    ['char_russell_bufalino', 'russell bufalino'],
    ['char_russell_bufalino', 'russell'],
    ['char_russell_bufalino', 'bufalino'],
    ['group_teamsters', 'teamsters'],
    ['group_teamsters_union', 'teamsters'],
    ['org_fbi', 'fbi'],
  ];
  for (const [entityId, phrase] of manualHints) {
    const entityInfo = entityById.get(entityId);
    if (!entityInfo) continue;
    addEntry(entityId, entityInfo.canonicalName, entityInfo.entityType, phrase, 'hint', 90);
  }

  // Add unique last names for character entities (helps "Hoffa", "Bufalino"; skip ambiguous tokens).
  const lastNameToEntityIds = new Map<string, string[]>();
  for (const entity of kg.entities) {
    if (entity.entityType !== 'character') continue;
    const parts = entity.canonicalName.toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1];
    if (last.length < 4) continue;
    const arr = lastNameToEntityIds.get(last) ?? [];
    arr.push(entity.entityId);
    lastNameToEntityIds.set(last, arr);
  }
  for (const [lastName, entityIds] of lastNameToEntityIds.entries()) {
    if (entityIds.length !== 1) continue;
    const entityId = entityIds[0];
    const entityInfo = entityById.get(entityId);
    if (!entityInfo) continue;
    addEntry(entityId, entityInfo.canonicalName, entityInfo.entityType, lastName, 'hint', 70);
  }

  // Longer phrases first; then priority.
  entries.sort((a, b) => b.phrase.length - a.phrase.length || b.priority - a.priority || a.phrase.localeCompare(b.phrase));
  return { entries, entityById };
}

async function getEntityDetectionLexicon(): Promise<EntityDetectionLexicon> {
  if (!entityLexiconCache) {
    entityLexiconCache = buildEntityDetectionLexicon();
  }
  return entityLexiconCache;
}

export async function detectEntitiesInQuestion(question: string): Promise<DetectedEntityMention[]> {
  const lexicon = await getEntityDetectionLexicon();
  if (lexicon.entries.length === 0) return [];

  const qLower = normalizeText(question);
  const hits: DetectedEntityMention[] = [];
  const occupied: Array<{ start: number; end: number }> = [];

  for (const entry of lexicon.entries) {
    const pattern = new RegExp(`(^|[^a-z0-9])(${escapeRegex(entry.phrase)})(?=$|[^a-z0-9])`, 'i');
    const match = pattern.exec(qLower);
    if (!match) continue;
    const matchText = match[2] ?? entry.phrase;
    const startIndex = (match.index ?? 0) + (match[1]?.length ?? 0);
    const endIndex = startIndex + matchText.length;

    const overlaps = occupied.some((span) => !(endIndex <= span.start || startIndex >= span.end));
    if (overlaps) continue;
    occupied.push({ start: startIndex, end: endIndex });

    hits.push({
      entityId: entry.entityId,
      canonicalName: entry.canonicalName,
      entityType: entry.entityType,
      matchedText: matchText,
      matchKind: entry.matchKind,
      startIndex,
    });
  }

  hits.sort((a, b) => a.startIndex - b.startIndex || a.canonicalName.localeCompare(b.canonicalName));

  // Deduplicate same entity while preserving first (leftmost) mention.
  const seenEntityIds = new Set<string>();
  const deduped: DetectedEntityMention[] = [];
  for (const hit of hits) {
    if (seenEntityIds.has(hit.entityId)) continue;
    seenEntityIds.add(hit.entityId);
    deduped.push(hit);
  }

  return deduped;
}

function appendRouteReasoning(answer: StructuredAnswerCore, routeReasoning: string): StructuredAnswerCore {
  const reasoningNotes = answer.reasoningNotes.includes(routeReasoning)
    ? answer.reasoningNotes
    : `${answer.reasoningNotes} ${routeReasoning}`.trim();
  return { ...answer, reasoningNotes };
}

function enforceEvidenceInvariant(answer: StructuredAnswerCore): StructuredAnswerCore {
  if (answer.evidenceRefs.length > 0) return answer;
  if (answer.eventsUsed.length === 0 && answer.stateChangesUsed.length === 0) return answer;
  return {
    ...answer,
    reasoningNotes: `${answer.reasoningNotes} Warning: no evidence refs were available for some cited rows in this deterministic pass.`,
  };
}

async function buildMainAnswer(context: AnswerBuilderContext, modeUsed: StructuredAnswerCore['modeUsed']): Promise<StructuredAnswerCore> {
  switch (modeUsed) {
    case 'kg':
      return buildKgAnswer(context);
    case 'ntg':
      return buildTraceAnswer(context);
    case 'hybrid':
      return buildHybridAnswer(context);
    case 'baseline_rag':
      return buildBaselineRagLikeAnswer(context);
    default:
      return buildKgAnswer(context);
  }
}

export async function answerQueryRequest(request: QueryRequest): Promise<QueryResponse> {
  const detectedEntities = await detectEntitiesInQuestion(request.question);
  const route = routeQuery(request.question, {
    preferredMode: request.preferredMode,
    entityCount: detectedEntities.length,
  });

  const context: AnswerBuilderContext = {
    question: request.question,
    queryType: route.queryType,
    routeReasoning: route.reasoning,
    entities: detectedEntities,
    includeEvidence: request.includeEvidence,
  };

  let mainAnswer = await buildMainAnswer(context, route.modeUsed);
  mainAnswer = enforceEvidenceInvariant(appendRouteReasoning(normalizeStructuredAnswer(mainAnswer), route.reasoning));
  mainAnswer = (
    await maybeSynthesizeStructuredAnswerWithLLM(mainAnswer, {
      question: request.question,
      label: `mode=${route.modeUsed}, query_type=${route.queryType}`,
    })
  ).answer;

  const shouldIncludeBaseline = request.includeBaselineComparison || route.queryType === 'comparison';
  let baselineComparison: StructuredAnswerCore | null = null;
  if (shouldIncludeBaseline && route.modeUsed !== 'baseline_rag') {
    const baselineAnswer = await buildBaselineRagLikeAnswer(context);
    baselineComparison = enforceEvidenceInvariant(
      appendRouteReasoning(normalizeStructuredAnswer(baselineAnswer), 'Baseline comparator generated for side-by-side deterministic comparison.'),
    );
  }

  if (!request.includeEvidence) {
    // Builders strip evidence refs, but apply here again for defense-in-depth if future builders skip it.
    mainAnswer = { ...mainAnswer, evidenceRefs: [] };
    if (baselineComparison) baselineComparison = { ...baselineComparison, evidenceRefs: [] };
  }

  return {
    question: request.question,
    ...mainAnswer,
    baselineComparison,
  };
}

export async function answerBaselineOnly(question: string, includeEvidence = true): Promise<QueryResponse> {
  const detectedEntities = await detectEntitiesInQuestion(question);
  const route = routeQuery(question, {
    preferredMode: 'baseline_rag',
    entityCount: detectedEntities.length,
  });
  const context: AnswerBuilderContext = {
    question,
    queryType: route.queryType,
    routeReasoning: route.reasoning,
    entities: detectedEntities,
    includeEvidence,
  };
  const baseline = await buildBaselineRagLikeAnswer(context);
  // Keep the explicit baseline endpoint deterministic for fair comparisons.
  const mainAnswer = enforceEvidenceInvariant(appendRouteReasoning(normalizeStructuredAnswer(baseline), route.reasoning));
  return {
    question,
    ...mainAnswer,
    baselineComparison: null,
  };
}

export function invalidateQueryServiceCaches(): void {
  entityLexiconCache = null;
}
