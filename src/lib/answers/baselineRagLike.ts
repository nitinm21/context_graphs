import { loadNtgArtifacts } from '../ntgData';
import type { StructuredAnswerCore } from '../queryContract';

import { displayEntityList, maybeStripEvidence, overlapScore, truncate, type AnswerBuilderContext } from './shared';

type RetrievalRow = {
  source: 'event' | 'script_block' | 'state_change';
  id: string;
  sceneId: string | null;
  text: string;
  evidenceRefs: string[];
  score: number;
};

export async function buildBaselineRagLikeAnswer(context: AnswerBuilderContext): Promise<StructuredAnswerCore> {
  const artifacts = await loadNtgArtifacts();
  if (!artifacts.available) {
    return maybeStripEvidence(
      {
        answerText:
          'Baseline retrieval is unavailable because narrative trace artifacts are missing. Generate Phase 3/4 artifacts and retry.',
        modeUsed: 'baseline_rag',
        queryType: context.queryType,
        confidence: 0.1,
        entitiesUsed: context.entities.map((e) => e.entityId),
        eventsUsed: [],
        stateChangesUsed: [],
        evidenceRefs: [],
        reasoningNotes: 'Baseline RAG-like placeholder depends on local event/script-block artifacts.',
      },
      context.includeEvidence,
    );
  }

  const entityIdSet = new Set(context.entities.map((e) => e.entityId));
  const docs: RetrievalRow[] = [];

  for (const event of artifacts.events) {
    const participantIds = new Set(event.participants.map((p) => p.entityId));
    const hasEntityMatch = entityIdSet.size === 0 || Array.from(entityIdSet).some((id) => participantIds.has(id));
    if (!hasEntityMatch) continue;

    const evidenceSpans = Array.isArray(event.metadata.evidence_spans) ? event.metadata.evidence_spans : [];
    const snippet = evidenceSpans.length
      ? String(((evidenceSpans[0] as Record<string, unknown>)?.snippet as string | undefined) ?? '')
      : '';
    const text = `${event.summary}\n${snippet}`.trim();
    docs.push({
      source: 'event',
      id: event.eventId,
      sceneId: event.sceneId,
      text,
      evidenceRefs: event.evidenceRefs,
      score: overlapScore(context.question, `${event.eventTypeL2} ${text}`),
    });
  }

  for (const sc of artifacts.stateChanges) {
    const hasEntityMatch =
      entityIdSet.size === 0 || entityIdSet.has(sc.subjectId) || entityIdSet.has(sc.objectId);
    if (!hasEntityMatch) continue;
    docs.push({
      source: 'state_change',
      id: sc.stateChangeId,
      sceneId: sc.sceneId,
      text: `${sc.stateDimension} ${sc.direction} ${sc.claimType} ${sc.subjectId} ${sc.objectId}`,
      evidenceRefs: sc.evidenceRefs,
      score: overlapScore(
        context.question,
        `${sc.stateDimension} ${sc.direction} ${sc.claimType} ${(sc.metadata.rule_ids as string[] | undefined)?.join(' ') ?? ''}`,
      ),
    });
  }

  for (const block of artifacts.scriptBlocks) {
    let hasEntityMatch = entityIdSet.size === 0;
    if (!hasEntityMatch) {
      const blockLower = `${block.speakerCueRaw ?? ''} ${block.text}`.toLowerCase();
      hasEntityMatch = context.entities.some((entity) => blockLower.includes(entity.canonicalName.toLowerCase()));
    }
    if (!hasEntityMatch) continue;

    docs.push({
      source: 'script_block',
      id: block.blockId,
      sceneId: block.sceneId,
      text: `${block.speakerCueRaw ? `${block.speakerCueRaw}: ` : ''}${block.text}`,
      evidenceRefs: [],
      score: overlapScore(context.question, `${block.blockType} ${block.text}`),
    });
  }

  docs.sort((a, b) => b.score - a.score || (a.sceneId ?? '').localeCompare(b.sceneId ?? '') || a.id.localeCompare(b.id));
  const top = docs.filter((row) => row.score > 0).slice(0, 6);

  const answerLines: string[] = [];
  if (top.length === 0) {
    answerLines.push(
      `Baseline retrieval found no strong lexical matches for this question. Try a more specific entity name or scene/event phrase.`,
    );
  } else {
    answerLines.push(
      `Baseline retrieval returned ${top.length} top text chunk(s) for ${displayEntityList(
        context.entities.map((e) => e.canonicalName),
      )}.`,
    );
    top.forEach((row, idx) => {
      const scenePrefix = row.sceneId ? ` (${row.sceneId})` : '';
      answerLines.push(`${idx + 1}. [${row.source}${scenePrefix}] ${truncate(row.text, 220)}`);
    });
    answerLines.push(
      'This baseline is lexical retrieval only; it does not explicitly model temporal edges or inferred relationship state changes.',
    );
  }

  const answer: StructuredAnswerCore = {
    answerText: answerLines.join('\n'),
    modeUsed: 'baseline_rag',
    queryType: context.queryType,
    confidence: top.length ? Math.min(0.78, 0.28 + top[0].score / 12) : 0.12,
    entitiesUsed: context.entities.map((e) => e.entityId),
    eventsUsed: top.filter((row) => row.source === 'event').map((row) => row.id),
    stateChangesUsed: top.filter((row) => row.source === 'state_change').map((row) => row.id),
    evidenceRefs: top.flatMap((row) => row.evidenceRefs),
    reasoningNotes:
      'Baseline RAG-like mode ranked event summaries, script blocks, and state-change labels by lexical overlap with the question.',
  };

  return maybeStripEvidence(answer, context.includeEvidence);
}
