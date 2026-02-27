export type QueryType = 'fact' | 'timeline' | 'state_change' | 'causal_chain' | 'evidence' | 'comparison';

export type AnswerMode = 'kg' | 'ntg' | 'hybrid' | 'baseline_rag';

export type PreferredMode = 'auto' | 'kg' | 'ntg' | 'hybrid' | 'baseline_rag' | 'baseline';

export type QuerySignals = {
  questionLower: string;
  hasWho: boolean;
  hasWhat: boolean;
  hasWhen: boolean;
  hasWhy: boolean;
  hasHow: boolean;
  mentionsEvidence: boolean;
  mentionsCompare: boolean;
  mentionsRag: boolean;
  mentionsStateChange: boolean;
  mentionsRelationship: boolean;
  mentionsTimeline: boolean;
  mentionsCause: boolean;
  mentionsSequence: boolean;
};

export type QueryRouteDecision = {
  queryType: QueryType;
  modeUsed: AnswerMode;
  reasoning: string;
  signals: QuerySignals;
  entityCount: number;
};

const EVIDENCE_KEYWORDS = [
  'evidence',
  'supporting scene',
  'supporting scenes',
  'supporting evidence',
  'what supports',
  'show supporting',
  'show proof',
  'cite',
  'cites',
  'proof',
  'which scene',
  'which scenes',
];

const COMPARISON_KEYWORDS = [
  'compare',
  'comparison',
  'versus',
  'vs ',
  'vs.',
  'baseline',
  'rag',
  'not just rag',
  'why is this not just rag',
];

const STATE_CHANGE_KEYWORDS = [
  'relationship',
  'change over time',
  'changes over time',
  'how does',
  'trust',
  'fear',
  'distance',
  'loyalty',
  'respect',
  'resentment',
  'state change',
  'trajectory',
];

const TIMELINE_KEYWORDS = [
  'timeline',
  'over time',
  'in order',
  'sequence',
  'before',
  'after',
  'when does',
  'when did',
  'what happens first',
  'what happens next',
];

const CAUSAL_KEYWORDS = [
  'lead up',
  'leads up',
  'leads to',
  'what events lead',
  'contributes to',
  'contribute to',
  'cause',
  'caused',
  'why did',
  'what makes',
  'because',
];

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

export function extractQuerySignals(question: string): QuerySignals {
  const q = question.trim().toLowerCase();
  return {
    questionLower: q,
    hasWho: /\bwho\b/.test(q),
    hasWhat: /\bwhat\b/.test(q),
    hasWhen: /\bwhen\b/.test(q),
    hasWhy: /\bwhy\b/.test(q),
    hasHow: /\bhow\b/.test(q),
    mentionsEvidence: includesAny(q, EVIDENCE_KEYWORDS),
    mentionsCompare: includesAny(q, COMPARISON_KEYWORDS),
    mentionsRag: q.includes('rag'),
    mentionsStateChange: includesAny(q, STATE_CHANGE_KEYWORDS),
    mentionsRelationship: q.includes('relationship') || q.includes('connected to') || q.includes('connected with'),
    mentionsTimeline: includesAny(q, TIMELINE_KEYWORDS),
    mentionsCause: includesAny(q, CAUSAL_KEYWORDS),
    mentionsSequence: q.includes('sequence') || q.includes('in order') || q.includes('chronolog') || q.includes('timeline'),
  };
}

export function classifyQueryType(question: string): QueryType {
  const s = extractQuerySignals(question);
  const q = s.questionLower;

  if (s.mentionsCompare) return 'comparison';

  // "Show supporting scenes for that conclusion" and similar evidence-centric asks.
  if (s.mentionsEvidence || (q.startsWith('show ') && q.includes('scene'))) return 'evidence';

  // State-change queries are prioritized over generic timeline cues.
  if (
    q.includes('relationship with') ||
    q.includes("relationship between") ||
    q.includes('relationship change') ||
    q.includes('state change') ||
    q.includes('how does') && q.includes('change over time') ||
    (s.mentionsStateChange && (q.includes('how does') || q.includes('over time') || q.includes('trajectory')))
  ) {
    return 'state_change';
  }

  // Causal chains next (often overlap with timeline wording).
  if (s.mentionsCause) return 'causal_chain';

  if (s.mentionsTimeline || s.hasWhen || s.mentionsSequence) return 'timeline';

  return 'fact';
}

export function normalizePreferredMode(preferredMode: PreferredMode | string | undefined): PreferredMode {
  const raw = (preferredMode ?? 'auto').toString().trim().toLowerCase();
  if (['auto', 'kg', 'ntg', 'hybrid', 'baseline_rag', 'baseline'].includes(raw)) {
    return raw as PreferredMode;
  }
  return 'auto';
}

export function selectModeForQueryType(
  queryType: QueryType,
  preferredMode: PreferredMode | string | undefined,
  options: { entityCount?: number } = {},
): { modeUsed: AnswerMode; reasoning: string } {
  const preferred = normalizePreferredMode(preferredMode);
  const entityCount = options.entityCount ?? 0;
  if (preferred !== 'auto') {
    if (preferred === 'baseline') {
      return { modeUsed: 'baseline_rag', reasoning: 'User preferred baseline mode override.' };
    }
    return { modeUsed: preferred as AnswerMode, reasoning: `User preferred ${preferred} mode override.` };
  }

  switch (queryType) {
    case 'fact':
      return {
        modeUsed: 'kg',
        reasoning: entityCount > 0 ? 'Fact-style query with entity mention routes to KG.' : 'Fact-style query defaults to KG lookup.',
      };
    case 'timeline':
      return { modeUsed: 'ntg', reasoning: 'Timeline/order query depends on event chronology and temporal edges (NTG).' };
    case 'state_change':
      return { modeUsed: 'ntg', reasoning: 'State-change query depends on inferred relationship shifts over time (NTG).' };
    case 'causal_chain':
      return { modeUsed: 'hybrid', reasoning: 'Causal-chain query benefits from NTG chronology plus KG entity context (hybrid).' };
    case 'evidence':
      return { modeUsed: 'hybrid', reasoning: 'Evidence query can require tracing prior answer structures plus source snippets (hybrid).' };
    case 'comparison':
      return { modeUsed: 'hybrid', reasoning: 'Comparison query is best answered by contrasting graph and baseline behavior (hybrid).' };
    default:
      return { modeUsed: 'kg', reasoning: 'Fallback to KG mode.' };
  }
}

export function routeQuery(
  question: string,
  options: { preferredMode?: PreferredMode | string; entityCount?: number } = {},
): QueryRouteDecision {
  const signals = extractQuerySignals(question);
  const queryType = classifyQueryType(question);
  const selected = selectModeForQueryType(queryType, options.preferredMode, { entityCount: options.entityCount });
  return {
    queryType,
    modeUsed: selected.modeUsed,
    reasoning: selected.reasoning,
    signals,
    entityCount: options.entityCount ?? 0,
  };
}

// Exported for Phase 5 pattern file and future UI diagnostics.
export const QUERY_ROUTER_KEYWORDS = {
  evidence: EVIDENCE_KEYWORDS,
  comparison: COMPARISON_KEYWORDS,
  stateChange: STATE_CHANGE_KEYWORDS,
  timeline: TIMELINE_KEYWORDS,
  causal: CAUSAL_KEYWORDS,
} as const;
