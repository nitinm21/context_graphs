import { NextRequest, NextResponse } from 'next/server';

import { loadNtgArtifacts } from '@/lib/ntgData';

export const runtime = 'nodejs';

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function uniqueStrings(values: string[], limit = 80): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const v = value.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function eventSnippets(event: { metadata: Record<string, unknown>; summary: string }): string[] {
  const spans = Array.isArray(event.metadata.evidence_spans) ? event.metadata.evidence_spans : [];
  const snippets: string[] = [];
  for (const span of spans) {
    const obj = asObject(span);
    const snippet = asString(obj.snippet);
    if (snippet && snippet.trim()) snippets.push(snippet.trim());
  }
  if (snippets.length === 0 && event.summary.trim()) snippets.push(event.summary.trim());
  return snippets;
}

function pairValue(a: string, b: string): string {
  return [a, b].sort().join('::');
}

function buildHref(base: string, params: Record<string, string | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    search.set(key, trimmed);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const obj = asObject(payload);
  const eventIds = uniqueStrings(asStringArray(obj.events_used) .concat(asStringArray(obj.eventsUsed)));
  const stateChangeIds = uniqueStrings(asStringArray(obj.state_changes_used).concat(asStringArray(obj.stateChangesUsed)));
  const evidenceRefs = uniqueStrings(asStringArray(obj.evidence_refs).concat(asStringArray(obj.evidenceRefs)));

  try {
    const artifacts = await loadNtgArtifacts();
    if (!artifacts.available) {
      return NextResponse.json({ available: false, items: [], unresolved_refs: evidenceRefs, missing_files: artifacts.missingFiles });
    }

    const stateChangeById = new Map(artifacts.stateChanges.map((sc) => [sc.stateChangeId, sc]));
    const items: Array<Record<string, unknown>> = [];
    const usedEvidenceRefSet = new Set<string>();

    for (const eventId of eventIds.slice(0, 40)) {
      const event = artifacts.eventById.get(eventId);
      if (!event) continue;
      const scene = artifacts.sceneById.get(event.sceneId) ?? null;
      const names = event.participants
        .map((p) => artifacts.entityById.get(p.entityId)?.canonicalName ?? p.entityId)
        .slice(0, 4);
      for (const ref of event.evidenceRefs) usedEvidenceRefSet.add(ref);
      items.push({
        kind: 'event',
        id: event.eventId,
        scene_id: event.sceneId,
        scene_header: scene?.headerRaw ?? null,
        title: event.eventTypeL2,
        snippet: truncate(eventSnippets(event)[0] ?? event.summary, 220),
        participants: names,
        evidence_ref_count: event.evidenceRefs.length,
        trace_href: buildHref('/trace', {
          focus: 'evidence',
          eventId: event.eventId,
          sceneId: event.sceneId,
        }),
        timeline_href: buildHref('/timeline', {
          q: event.eventId,
        }),
        tags: ['event', event.eventTypeL1, event.eventTypeL2],
      });
    }

    for (const stateChangeId of stateChangeIds.slice(0, 30)) {
      const sc = stateChangeById.get(stateChangeId);
      if (!sc) continue;
      const scene = artifacts.sceneById.get(sc.sceneId) ?? null;
      const subjectName = artifacts.entityById.get(sc.subjectId)?.canonicalName ?? sc.subjectId;
      const objectName = artifacts.entityById.get(sc.objectId)?.canonicalName ?? sc.objectId;
      const triggerEvents = sc.triggerEventIds
        .map((eventId) => artifacts.eventById.get(eventId))
        .filter((event): event is NonNullable<typeof event> => !!event);
      const triggerSnippet = triggerEvents.length ? eventSnippets(triggerEvents[0])[0] ?? triggerEvents[0].summary : '';
      for (const ref of sc.evidenceRefs) usedEvidenceRefSet.add(ref);
      items.push({
        kind: 'state_change',
        id: sc.stateChangeId,
        scene_id: sc.sceneId,
        scene_header: scene?.headerRaw ?? null,
        title: `${sc.stateDimension}:${sc.direction}`,
        snippet: truncate(
          `${subjectName} -> ${objectName} (${sc.claimType}, conf ${sc.confidence.toFixed(2)}). ${triggerSnippet}`.trim(),
          240,
        ),
        claim_type: sc.claimType,
        trigger_event_ids: sc.triggerEventIds,
        pair: pairValue(sc.subjectId, sc.objectId),
        trace_href: buildHref('/trace', {
          focus: 'evidence',
          stateChangeId: sc.stateChangeId,
          sceneId: sc.sceneId,
          pair: pairValue(sc.subjectId, sc.objectId),
        }),
        timeline_href: buildHref('/timeline', {
          pair: pairValue(sc.subjectId, sc.objectId),
          q: sc.stateChangeId,
        }),
        tags: ['state_change', sc.claimType, sc.stateDimension],
      });
    }

    for (const ref of evidenceRefs.slice(0, 60)) {
      if (usedEvidenceRefSet.has(ref)) continue;
      if (ref.startsWith('scene:')) {
        const sceneId = ref.slice('scene:'.length);
        const scene = artifacts.sceneById.get(sceneId) ?? null;
        const block = (artifacts.scriptBlocksBySceneId.get(sceneId) ?? [])[0] ?? null;
        items.push({
          kind: 'scene_ref',
          id: ref,
          scene_id: sceneId,
          scene_header: scene?.headerRaw ?? null,
          title: 'Scene reference',
          snippet: truncate(block?.text ?? scene?.headerRaw ?? ref, 220),
          trace_href: buildHref('/trace', {
            focus: 'evidence',
            sceneId,
          }),
          timeline_href: buildHref('/timeline', {
            q: sceneId,
          }),
          tags: ['scene_ref'],
        });
        continue;
      }
      items.push({
        kind: 'raw_ref',
        id: ref,
        scene_id: null,
        scene_header: null,
        title: 'Evidence reference',
        snippet: ref,
        trace_href: buildHref('/trace', {
          focus: 'evidence',
          q: ref,
        }),
        timeline_href: buildHref('/timeline', {
          q: ref,
        }),
        tags: ['raw_ref'],
      });
    }

    return NextResponse.json({
      available: true,
      items,
      unresolved_refs: evidenceRefs.filter((ref) => !usedEvidenceRefSet.has(ref) && !ref.startsWith('scene:')),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Evidence lookup failed: ${message}` }, { status: 500 });
  }
}
