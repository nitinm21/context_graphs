import { getEntityNeighbors, listEntities, loadKgArtifacts } from '../kgData';
import type { StructuredAnswerCore } from '../queryContract';

import { maybeStripEvidence, truncate, type AnswerBuilderContext } from './shared';

function predicateWeight(predicate: string): number {
  const p = predicate.toLowerCase();
  if (p === 'family') return 100;
  if (p === 'associated_with') return 95;
  if (p === 'works_with' || p === 'allied_with') return 90;
  if (p === 'advisor_to' || p === 'counsel_to') return 85;
  if (p === 'co_present_dialogue') return 50;
  return 60;
}

export async function buildKgAnswer(context: AnswerBuilderContext): Promise<StructuredAnswerCore> {
  const kg = await loadKgArtifacts();
  if (!kg.available) {
    return maybeStripEvidence(
      {
        answerText: 'KG artifacts are unavailable. Run the Phase 2 entity/KG builders and retry.',
        modeUsed: 'kg',
        queryType: context.queryType,
        confidence: 0.1,
        entitiesUsed: context.entities.map((e) => e.entityId),
        eventsUsed: [],
        stateChangesUsed: [],
        evidenceRefs: [],
        reasoningNotes: 'KG answer builder depends on entities.json and kg_edges.json.',
      },
      context.includeEvidence,
    );
  }

  const focusMention = context.entities[0] ?? null;
  if (focusMention) {
    const neighborhood = await getEntityNeighbors(focusMention.entityId);
    if (neighborhood.available && neighborhood.entity) {
      const ranked = [...neighborhood.neighbors].sort((a, b) => {
        const aw = predicateWeight(a.edge.predicate);
        const bw = predicateWeight(b.edge.predicate);
        if (aw !== bw) return bw - aw;
        const an = a.neighbor?.canonicalName ?? a.edge.edgeId;
        const bn = b.neighbor?.canonicalName ?? b.edge.edgeId;
        return an.localeCompare(bn);
      });
      const rows = ranked.slice(0, 8);
      const characterRows = rows.filter((row) => row.neighbor?.entityType === 'character');
      const emphasisRows = characterRows.length >= 3 ? characterRows.slice(0, 6) : rows;

      const answerLines = [
        `KG view of ${neighborhood.entity.canonicalName}: ${emphasisRows.length} high-signal relationship(s) from the local graph artifact.`,
        ...emphasisRows.map((row, idx) => {
          const neighborLabel = row.neighbor ? `${row.neighbor.canonicalName} (${row.neighbor.entityType})` : row.edge.objectId;
          const dir = row.direction === 'outgoing' ? 'out' : 'in';
          const evidenceCount = row.edge.evidenceRefs.length;
          return `${idx + 1}. [${dir}] ${row.edge.predicate} -> ${neighborLabel} [${row.edge.stability}]${
            evidenceCount ? `, evidence refs: ${evidenceCount}` : ''
          }`;
        }),
      ];

      if (ranked.length > emphasisRows.length) {
        answerLines.push(`Additional relationships omitted for brevity: ${ranked.length - emphasisRows.length}.`);
      }

      const answer: StructuredAnswerCore = {
        answerText: answerLines.join('\n'),
        modeUsed: 'kg',
        queryType: context.queryType,
        confidence: Math.min(0.95, 0.55 + emphasisRows.length * 0.05),
        entitiesUsed: [neighborhood.entity.entityId, ...emphasisRows.flatMap((row) => (row.neighbor ? [row.neighbor.entityId] : []))],
        eventsUsed: [],
        stateChangesUsed: [],
        evidenceRefs: emphasisRows.flatMap((row) => row.edge.evidenceRefs),
        reasoningNotes:
          'KG mode returns canonical entities and relationship edges (static/semi-stable/volatile) without timeline sequencing.',
      };

      return maybeStripEvidence(answer, context.includeEvidence);
    }
  }

  const entitySearch = await listEntities({ q: context.question, limit: 8 });
  const topEntities = entitySearch.available ? entitySearch.items.slice(0, 5) : [];
  const fallbackLines = [
    topEntities.length
      ? `KG entity search candidates for this question (no direct focus entity detected):`
      : `No direct entity match detected for this fact-style query.`,
    ...topEntities.map((entity, idx) => `${idx + 1}. ${entity.canonicalName} (${entity.entityType}) [${entity.entityId}]`),
    topEntities.length
      ? 'Ask with a specific entity name (for example "Frank Sheeran" or "Jimmy Hoffa") for relationship neighbors.'
      : 'Try including a specific person or organization name to retrieve KG relationships.',
  ];

  const answer: StructuredAnswerCore = {
    answerText: fallbackLines.map((line) => truncate(line, 220)).join('\n'),
    modeUsed: 'kg',
    queryType: context.queryType,
    confidence: topEntities.length ? 0.42 : 0.2,
    entitiesUsed: [...context.entities.map((e) => e.entityId), ...topEntities.map((e) => e.entityId)],
    eventsUsed: [],
    stateChangesUsed: [],
    evidenceRefs: [],
    reasoningNotes: 'KG mode fell back to entity-name search because no specific graph neighborhood target was detected.',
  };

  return maybeStripEvidence(answer, context.includeEvidence);
}
