import Link from 'next/link';

import { listDebugEvents } from '@/lib/traceData';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSingle(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function buildHref(base: string, updates: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(updates)) {
    if (value && value.trim()) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function EventsDebugPage({ searchParams }: PageProps) {
  const params = (searchParams ? await searchParams : {}) ?? {};
  const q = getSingle(params, 'q').trim();
  const eventType = getSingle(params, 'eventType').trim();
  const sceneId = getSingle(params, 'sceneId').trim();
  const entityId = getSingle(params, 'entityId').trim();
  const l1 = getSingle(params, 'l1').trim();

  const result = await listDebugEvents({ q, eventType, sceneId, entityId, l1, limit: 200 });

  return (
    <main id="main-content">
      <section className="hero" aria-labelledby="events-debug-title">
        <p className="eyebrow">Trace Debug</p>
        <h1 id="events-debug-title">Phase 3 Events Debug</h1>
        <p className="subtitle">
          Filter extracted observable events by taxonomy label, scene, and entity, then inspect evidence snippets and participant mappings.
        </p>
      </section>

      {!result.available ? (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h2>Trace Artifacts Missing</h2>
          <ul className="list">
            <li>
              <span className="mono">python3 scripts/extract_events.py</span>
            </li>
            <li>
              <span className="mono">python3 scripts/eval_taxonomy_coverage.py --release</span>
            </li>
          </ul>
          {result.missingFiles?.length ? (
            <ul className="list" style={{ marginTop: '0.75rem' }}>
              {result.missingFiles.map((file) => (
                <li key={file}>
                  Missing: <span className="mono">{file}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <>
          <section className="grid" aria-label="Trace debug summary panels">
            <article className="card">
              <h2>Artifact Summary</h2>
              <dl className="kv">
                <dt>Total Events</dt>
                <dd>{result.total}</dd>
                <dt>Filtered</dt>
                <dd>{result.filtered}</dd>
                <dt>L1 Labels</dt>
                <dd>{result.l1Options.length}</dd>
                <dt>L2 Labels</dt>
                <dd>{result.eventTypeOptions.length}</dd>
              </dl>
            </article>
            <article className="card">
              <h2>Quick Filters</h2>
              <div className="pill-row">
                {['voiceover_narration', 'road_trip_segment', 'union_meeting_or_union_office_interaction', 'shooting', 'family_interaction'].map(
                  (typeName) => (
                    <Link
                      key={typeName}
                      className={`pill ${eventType === typeName ? 'active' : ''}`}
                      href={buildHref('/trace/events-debug', { q, eventType: typeName, sceneId, entityId, l1 })}
                    >
                      {typeName}
                    </Link>
                  ),
                )}
              </div>
              <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                These highlight the Irishman-specific motifs called out in the Phase 3 PRD.
              </p>
            </article>
          </section>

          <section className="card" style={{ marginTop: '1rem' }}>
            <h2 className="section-title">Filters</h2>
            <form method="get" action="/trace/events-debug" className="toolbar">
              <div className="field">
                <label htmlFor="q">Search Text</label>
                <input id="q" name="q" defaultValue={q} placeholder="event summary or evidence snippet" />
              </div>
              <div className="field">
                <label htmlFor="l1">L1 Category</label>
                <select id="l1" name="l1" defaultValue={l1}>
                  <option value="">All</option>
                  {result.l1Options.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="eventType">L2 Event Type</label>
                <select id="eventType" name="eventType" defaultValue={eventType}>
                  <option value="">All</option>
                  {result.eventTypeOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="entityId">Entity</label>
                <select id="entityId" name="entityId" defaultValue={entityId}>
                  <option value="">All</option>
                  {result.entityOptions.slice(0, 200).map((entity) => (
                    <option key={entity.entityId} value={entity.entityId}>
                      {entity.canonicalName} ({entity.entityType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sceneId">Scene</label>
                <select id="sceneId" name="sceneId" defaultValue={sceneId}>
                  <option value="">All</option>
                  {result.sceneOptions.slice(0, 320).map((scene) => (
                    <option key={scene.sceneId} value={scene.sceneId}>
                      {scene.sceneId} - {scene.headerRaw}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="button">
                Apply
              </button>
              <Link className="button secondary" href="/trace/events-debug">
                Reset
              </Link>
            </form>
          </section>

          <section className="card" style={{ marginTop: '1rem' }}>
            <h2>Event Rows</h2>
            <p className="muted">
              Showing {result.items.length} of {result.filtered} matching events ({result.total} total). Limit: 200 rows.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Scene / Seq</th>
                    <th>Taxonomy</th>
                    <th>Summary</th>
                    <th>Participants</th>
                    <th>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((event) => {
                    const scene = result.sceneById.get(event.sceneId);
                    const evidenceSpans = Array.isArray(event.metadata.evidence_spans)
                      ? event.metadata.evidence_spans
                      : [];
                    return (
                      <tr key={event.eventId}>
                        <td>
                          <div className="mono">{event.eventId}</div>
                          <div>
                            {event.sceneId} / {event.sequenceInScene}
                          </div>
                          {scene ? (
                            <div className="muted" style={{ marginTop: '0.25rem' }}>
                              {scene.headerRaw}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <div className="mono">{event.eventTypeL1}</div>
                          <div className="mono muted" style={{ marginTop: '0.2rem' }}>
                            {event.eventTypeL2}
                          </div>
                          <div className="muted" style={{ marginTop: '0.25rem' }}>
                            conf {event.confidence.toFixed(2)}
                          </div>
                        </td>
                        <td>
                          <div>{event.summary}</div>
                          <div className="muted mono" style={{ marginTop: '0.3rem' }}>
                            {event.extractionMethod}
                          </div>
                        </td>
                        <td>
                          {event.participants.length ? (
                            <ul className="list">
                              {event.participants.map((p) => {
                                const entity = result.entityById.get(p.entityId);
                                return (
                                  <li key={`${event.eventId}-${p.entityId}-${p.role}`}>
                                    <span className="mono">{p.role}</span>: {entity?.canonicalName ?? p.entityId}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <span className="muted">-</span>
                          )}
                        </td>
                        <td>
                          {evidenceSpans.length ? (
                            <ul className="list">
                              {evidenceSpans.map((span, idx) => {
                                const s = (span && typeof span === 'object' ? (span as Record<string, unknown>) : {}) as Record<
                                  string,
                                  unknown
                                >;
                                return (
                                  <li key={`${event.eventId}-evidence-${idx}`}>
                                    <div className="mono">
                                      {String(s.evidence_ref_id ?? '')} · {String(s.block_type ?? '')} · lines {String(s.line_start ?? '')}-
                                      {String(s.line_end ?? '')}
                                    </div>
                                    <div>{String(s.snippet ?? '')}</div>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <span className="muted">No evidence spans</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {result.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        No events matched the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
