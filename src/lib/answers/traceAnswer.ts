import { getTimelineSlice, listStateChanges, listTraceExplorerEvents } from '../ntgData';
import type { QueryType, StructuredAnswerCore } from '../queryContract';

import { displayEntityList, maybeStripEvidence, truncate, type AnswerBuilderContext } from './shared';

function pairFromContext(context: AnswerBuilderContext): string | undefined {
  if (context.entities.length < 2) return undefined;
  const ids = [context.entities[0].entityId, context.entities[1].entityId].sort();
  return `${ids[0]}::${ids[1]}`;
}

function qLooksLikeYear(q: string): number | undefined {
  const match = q.match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

function contextEntityIds(context: AnswerBuilderContext): string[] {
  return context.entities.map((e) => e.entityId);
}

function traceTextFilterFromQuestion(context: AnswerBuilderContext): string | undefined {
  const question = context.question.trim();
  if (!question) return undefined;

  // Timeline questions are usually natural-language asks ("When does X happen relative to Y?")
  // and the NTG `q` filters use literal substring matching, which can over-filter to zero rows.
  // Prefer structured filters (year, entity, pair) for timeline mode.
  if (context.queryType === 'timeline') return undefined;

  return question;
}

function collectTraceEvidenceRefs(rows: Array<{ event?: { evidenceRefs: string[] }; stateChange?: { evidenceRefs: string[] } }>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const refs = [
      ...(row.event?.evidenceRefs ?? []),
      ...(row.stateChange?.evidenceRefs ?? []),
    ];
    for (const ref of refs) {
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

function summarizeStateChangesAnswer(
  context: AnswerBuilderContext,
  rows: Awaited<ReturnType<typeof listStateChanges>>,
): StructuredAnswerCore {
  if (!rows.available) {
    return maybeStripEvidence(
      {
        answerText: 'NTG state-change artifacts are unavailable. Run Phase 4 generation and retry.',
        modeUsed: 'ntg',
        queryType: context.queryType,
        confidence: 0.12,
        entitiesUsed: contextEntityIds(context),
        eventsUsed: [],
        stateChangesUsed: [],
        evidenceRefs: [],
        reasoningNotes: 'State-change answer builder depends on state_changes.json and supporting NTG artifacts.',
      },
      context.includeEvidence,
    );
  }

  const top = rows.items.slice(0, 8);
  if (top.length === 0) {
    return maybeStripEvidence(
      {
        answerText:
          'No inferred state changes matched the current question filters. Try specifying a relationship pair (for example Frank and Peggy) or a dimension like trust/fear/distance.',
        modeUsed: 'ntg',
        queryType: context.queryType,
        confidence: 0.25,
        entitiesUsed: contextEntityIds(context),
        eventsUsed: [],
        stateChangesUsed: [],
        evidenceRefs: [],
        reasoningNotes: 'NTG state-change retrieval returned zero rows for the inferred pair/entity filters.',
      },
      context.includeEvidence,
    );
  }

  const lines = [
    `NTG state-change view (${top.length} of ${rows.filtered} matching changes) for ${displayEntityList(
      context.entities.map((e) => e.canonicalName),
    )}.`,
  ];
  for (const item of top) {
    const sc = item.stateChange;
    const subject = item.subject?.canonicalName ?? sc.subjectId;
    const object = item.object?.canonicalName ?? sc.objectId;
    const sceneLabel = item.scene?.headerRaw ?? sc.sceneId;
    const triggerList = item.triggerEvents
      .slice(0, 2)
      .map((event) => `${event.eventTypeL2} (${event.sceneId}/${event.sequenceInScene})`)
      .join('; ');
    lines.push(
      `- ${subject} -> ${object}: ${sc.stateDimension} ${sc.direction}${sc.magnitude ? ` (${sc.magnitude})` : ''} [${sc.claimType}] in ${sceneLabel} (conf ${sc.confidence.toFixed(2)}).${triggerList ? ` Triggers: ${triggerList}.` : ''}`,
    );
  }
  if (rows.filtered > top.length) {
    lines.push(`Additional matching state changes omitted: ${rows.filtered - top.length}.`);
  }

  const eventsUsed = top.flatMap((item) => item.triggerEvents.map((event) => event.eventId));
  const stateChangesUsed = top.map((item) => item.stateChange.stateChangeId);
  const evidenceRefs = top.flatMap((item) => item.stateChange.evidenceRefs);

  return maybeStripEvidence(
    {
      answerText: lines.map((line) => truncate(line, 320)).join('\n'),
      modeUsed: 'ntg',
      queryType: context.queryType,
      confidence: Math.min(0.92, 0.58 + top.length * 0.04),
      entitiesUsed: [
        ...contextEntityIds(context),
        ...top.flatMap((item) => [item.stateChange.subjectId, item.stateChange.objectId]),
      ],
      eventsUsed,
      stateChangesUsed,
      evidenceRefs,
      reasoningNotes:
        'NTG mode answered using inferred state changes linked to trigger events and evidence refs; inferred vs explicit claims remain labeled.',
    },
    context.includeEvidence,
  );
}

function summarizeTimelineLikeAnswer(
  context: AnswerBuilderContext,
  queryType: QueryType,
  traceRows: Awaited<ReturnType<typeof listTraceExplorerEvents>>,
  timeline: Awaited<ReturnType<typeof getTimelineSlice>>,
): StructuredAnswerCore {
  if (!traceRows.available || !timeline.available) {
    return maybeStripEvidence(
      {
        answerText: 'NTG artifacts are unavailable. Run Phase 3/4 generation and retry.',
        modeUsed: 'ntg',
        queryType,
        confidence: 0.12,
        entitiesUsed: contextEntityIds(context),
        eventsUsed: [],
        stateChangesUsed: [],
        evidenceRefs: [],
        reasoningNotes: 'Trace/timeline answer builder depends on events, temporal edges, and scene index artifacts.',
      },
      context.includeEvidence,
    );
  }

  const topEvents = traceRows.items.slice(0, queryType === 'causal_chain' ? 10 : 8);
  const topScenes = timeline.scenes.slice(0, 6);

  if (topEvents.length === 0 && topScenes.length === 0) {
    return maybeStripEvidence(
      {
        answerText: 'No matching timeline events were found. Try adding a character name, event type, or year.',
        modeUsed: 'ntg',
        queryType,
        confidence: 0.22,
        entitiesUsed: contextEntityIds(context),
        eventsUsed: [],
        stateChangesUsed: [],
        evidenceRefs: [],
        reasoningNotes: 'Timeline/event search returned zero rows for the current query filters.',
      },
      context.includeEvidence,
    );
  }

  const heading =
    queryType === 'causal_chain'
      ? `Heuristic event chain (NTG) for ${displayEntityList(context.entities.map((e) => e.canonicalName))}:`
      : `Scene-ordered NTG timeline slice for ${displayEntityList(context.entities.map((e) => e.canonicalName))}:`;
  const lines: string[] = [heading];

  topScenes.forEach((scene, idx) => {
    const sceneHeader = scene.scene.headerRaw || scene.scene.sceneId;
    const year = scene.year ?? scene.scene.yearExplicit ?? scene.scene.yearInferred;
    const matchingTag =
      scene.matchingEventCount || scene.matchingStateChangeCount
        ? ` matched events=${scene.matchingEventCount}, state changes=${scene.matchingStateChangeCount}`
        : '';
    lines.push(`${idx + 1}. ${scene.scene.sceneId} [${year ?? '-'}] ${truncate(sceneHeader, 140)}${matchingTag}`);
    for (const event of scene.events.slice(0, 3)) {
      const overlayCount = traceRows.items.find((row) => row.event.eventId === event.eventId)?.stateChangesTriggered.length ?? 0;
      const overlayLabel = overlayCount ? `, state overlays=${overlayCount}` : '';
      lines.push(
        `   - ${event.eventId} ${event.eventTypeL2} (#${event.sequenceInScene}${overlayLabel}): ${truncate(event.summary, 160)}`,
      );
    }
  });

  if (queryType === 'causal_chain') {
    lines.push(
      'This is a heuristic chain assembled from filtered event order and state-change overlays; it is not a formal causal proof.',
    );
  }

  const eventsUsed = topEvents.map((row) => row.event.eventId);
  const stateChangesUsed = topEvents.flatMap((row) => row.stateChangesTriggered.map((sc) => sc.stateChangeId));
  const evidenceRefs = topEvents.flatMap((row) => row.event.evidenceRefs);

  return maybeStripEvidence(
    {
      answerText: lines.map((line) => truncate(line, 360)).join('\n'),
      modeUsed: 'ntg',
      queryType,
      confidence: Math.min(0.88, 0.5 + Math.min(topEvents.length, 10) * 0.03),
      entitiesUsed: [
        ...contextEntityIds(context),
        ...topEvents.flatMap((row) => row.participants.map((p) => p.entityId)),
      ],
      eventsUsed,
      stateChangesUsed,
      evidenceRefs,
      reasoningNotes:
        queryType === 'timeline'
          ? 'NTG mode answered using scene/event ordering plus temporal edges and evidence-linked event nodes.'
          : 'NTG mode provided a heuristic chain using filtered event order and state-change overlays.',
    },
    context.includeEvidence,
  );
}

export async function buildTraceAnswer(context: AnswerBuilderContext): Promise<StructuredAnswerCore> {
  const pair = pairFromContext(context);
  const primaryEntityId = context.entities[0]?.entityId;
  const derivedYear = qLooksLikeYear(context.question);
  const traceTextFilter = traceTextFilterFromQuestion(context);

  if (context.queryType === 'state_change') {
    const rows = await listStateChanges({
      pair,
      entityId: pair ? undefined : primaryEntityId,
      limit: 40,
    });
    return summarizeStateChangesAnswer(context, rows);
  }

  if (context.queryType === 'evidence') {
    // Evidence requests still use NTG rows but with a more evidence-centric summary.
    const traceRows = await listTraceExplorerEvents({
      q: context.question,
      entityId: primaryEntityId,
      pair,
      year: derivedYear,
      limit: 14,
    });
    if (!traceRows.available) {
      return summarizeTimelineLikeAnswer(
        context,
        'evidence',
        traceRows as Awaited<ReturnType<typeof listTraceExplorerEvents>>,
        { available: false } as Awaited<ReturnType<typeof getTimelineSlice>>,
      );
    }
    const top = traceRows.items.slice(0, 8);
    const lines = [
      `Evidence-centric NTG response (${top.length} event(s)) for ${displayEntityList(context.entities.map((e) => e.canonicalName))}.`,
    ];
    top.forEach((row, idx) => {
      const snippet = Array.isArray(row.event.metadata.evidence_spans)
        ? String((row.event.metadata.evidence_spans[0] as Record<string, unknown> | undefined)?.snippet ?? '')
        : '';
      lines.push(
        `${idx + 1}. ${row.event.eventId} ${row.event.eventTypeL2} in ${row.scene?.headerRaw ?? row.event.sceneId} [refs: ${
          row.event.evidenceRefs.length
        }] ${truncate(snippet || row.event.summary, 180)}`,
      );
    });
    const answer: StructuredAnswerCore = {
      answerText: lines.join('\n'),
      modeUsed: 'ntg',
      queryType: 'evidence',
      confidence: top.length ? Math.min(0.86, 0.45 + top.length * 0.04) : 0.2,
      entitiesUsed: [...contextEntityIds(context), ...top.flatMap((row) => row.participants.map((p) => p.entityId))],
      eventsUsed: top.map((row) => row.event.eventId),
      stateChangesUsed: top.flatMap((row) => row.stateChangesTriggered.map((sc) => sc.stateChangeId)),
      evidenceRefs: top.flatMap((row) => row.event.evidenceRefs),
      reasoningNotes: 'NTG evidence response selected events and surfaced their evidence refs/snippets directly.',
    };
    return maybeStripEvidence(answer, context.includeEvidence);
  }

  const [traceRows, timeline] = await Promise.all([
    listTraceExplorerEvents({
      q: traceTextFilter,
      entityId: primaryEntityId,
      eventType: undefined,
      pair,
      year: derivedYear,
      limit: 40,
    }),
    getTimelineSlice({
      q: context.queryType === 'timeline' ? traceTextFilter : undefined,
      entityId: primaryEntityId,
      pair,
      year: derivedYear,
      limitScenes: 8,
      includeBlocks: false,
    }),
  ]);

  return summarizeTimelineLikeAnswer(context, context.queryType, traceRows, timeline);
}
