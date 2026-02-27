import type { QueryType, StructuredAnswerCore } from '../queryContract';

export type DetectedEntityMention = {
  entityId: string;
  canonicalName: string;
  entityType: string;
  matchedText: string;
  matchKind: 'canonical' | 'alias' | 'hint';
  startIndex: number;
};

export type AnswerBuilderContext = {
  question: string;
  queryType: QueryType;
  routeReasoning: string;
  entities: DetectedEntityMention[];
  includeEvidence: boolean;
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function uniqueStrings(values: string[]): string[] {
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

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

export function overlapScore(query: string, text: string): number {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return 0;
  const tTokens = tokenize(text);
  if (tTokens.length === 0) return 0;

  let hits = 0;
  for (const token of tTokens) {
    if (qTokens.has(token)) hits += 1;
  }

  // Slight phrase bonus for direct substring match.
  const substringBonus = text.toLowerCase().includes(query.trim().toLowerCase()) ? 2 : 0;
  return hits + substringBonus;
}

export function displayEntityList(names: string[], maxItems = 4): string {
  const items = names.filter(Boolean);
  if (items.length === 0) return 'no matched entities';
  if (items.length <= maxItems) return items.join(', ');
  return `${items.slice(0, maxItems).join(', ')} (+${items.length - maxItems} more)`;
}

export function maybeStripEvidence<T extends StructuredAnswerCore>(answer: T, includeEvidence: boolean): T {
  if (includeEvidence) return answer;
  return {
    ...answer,
    evidenceRefs: [],
    reasoningNotes: answer.reasoningNotes.includes('Evidence refs omitted by request')
      ? answer.reasoningNotes
      : `${answer.reasoningNotes} Evidence refs omitted by request.`,
  };
}

export function mergeAnswerCores(
  primary: StructuredAnswerCore,
  secondary: StructuredAnswerCore,
  overrides: Partial<StructuredAnswerCore> = {},
): StructuredAnswerCore {
  return {
    answerText: overrides.answerText ?? primary.answerText,
    modeUsed: overrides.modeUsed ?? primary.modeUsed,
    queryType: overrides.queryType ?? primary.queryType,
    confidence: overrides.confidence ?? Math.max(primary.confidence, secondary.confidence) * 0.95,
    entitiesUsed: uniqueStrings([...(overrides.entitiesUsed ?? []), ...primary.entitiesUsed, ...secondary.entitiesUsed]),
    eventsUsed: uniqueStrings([...(overrides.eventsUsed ?? []), ...primary.eventsUsed, ...secondary.eventsUsed]),
    stateChangesUsed: uniqueStrings([...(overrides.stateChangesUsed ?? []), ...primary.stateChangesUsed, ...secondary.stateChangesUsed]),
    evidenceRefs: uniqueStrings([...(overrides.evidenceRefs ?? []), ...primary.evidenceRefs, ...secondary.evidenceRefs]),
    reasoningNotes: overrides.reasoningNotes ?? `${primary.reasoningNotes} ${secondary.reasoningNotes}`.trim(),
  };
}
