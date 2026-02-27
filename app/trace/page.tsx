import Link from 'next/link';

import { getNtgSummary, listStateChanges, listTraceExplorerEvents } from '@/lib/ntgData';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CORE_PAIR_PRESETS = [
  {
    value: 'char_frank_sheeran::char_peggy_sheeran',
    label: 'Frank <> Peggy',
  },
  {
    value: 'char_frank_sheeran::char_jimmy_hoffa',
    label: 'Frank <> Hoffa',
  },
  {
    value: 'char_frank_sheeran::char_russell_bufalino',
    label: 'Frank <> Russell',
  },
] as const;

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

function toYearValue(input: string): number | undefined {
  if (!input.trim()) return undefined;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default async function TracePage({ searchParams }: PageProps) {
  const params = (searchParams ? await searchParams : {}) ?? {};
  const focus = getSingle(params, 'focus').trim();
  const q = getSingle(params, 'q').trim();
  const sceneId = getSingle(params, 'sceneId').trim();
  const eventId = getSingle(params, 'eventId').trim();
  const stateChangeId = getSingle(params, 'stateChangeId').trim();
  const entityId = getSingle(params, 'entityId').trim();
  const eventType = getSingle(params, 'eventType').trim();
  const yearRaw = getSingle(params, 'year').trim();
  const pair = getSingle(params, 'pair').trim();
  const locationQ = getSingle(params, 'locationQ').trim();
  const year = toYearValue(yearRaw);
  const isEvidenceFocus = focus === 'evidence' || Boolean(sceneId || eventId || stateChangeId);

  const [summary, traceRows, stateChangesOverlay] = await Promise.all([
    getNtgSummary(),
    listTraceExplorerEvents({
      q,
      sceneId,
      eventId,
      entityId,
      eventType,
      year,
      pair,
      locationQ,
      limit: isEvidenceFocus ? 60 : 180,
    }),
    listStateChanges({
      stateChangeId,
      pair,
      entityId,
      sceneId,
      limit: isEvidenceFocus ? 24 : 14,
    }),
  ]);

  const focusedEventRow = eventId ? traceRows.items.find((row) => row.event.eventId === eventId) ?? null : null;
  const focusedStateChangeRow = stateChangeId
    ? stateChangesOverlay.items.find((row) => row.stateChange.stateChangeId === stateChangeId) ?? null
    : null;
  const focusedSceneId = sceneId || focusedEventRow?.event.sceneId || focusedStateChangeRow?.stateChange.sceneId || '';
  const focusedScene =
    (focusedEventRow?.scene ?? focusedStateChangeRow?.scene ?? traceRows.items.find((row) => row.event.sceneId === focusedSceneId)?.scene) ?? null;
  const focusedSceneEvents = focusedSceneId ? traceRows.items.filter((row) => row.event.sceneId === focusedSceneId).slice(0, 8) : [];
  const focusedSceneStateChanges = focusedSceneId
    ? stateChangesOverlay.items.filter((row) => row.stateChange.sceneId === focusedSceneId).slice(0, 8)
    : [];

  const focusTitle = focusedEventRow
    ? 'Focused Event Review'
    : focusedStateChangeRow
      ? 'Focused State-Change Review'
      : focusedSceneId
        ? 'Focused Scene Review'
        : 'Evidence Review Focus';

  return (
    <main id="main-content">
      <section className="hero" aria-labelledby="trace-title">
        <p className="eyebrow">{isEvidenceFocus ? 'Trace Review' : 'Narrative Context Graph'}</p>
        <h1 id="trace-title">{isEvidenceFocus ? focusTitle : 'NCG Explorer'}</h1>
        <p className="subtitle">
          {isEvidenceFocus
            ? 'You opened Trace from an evidence row. This page is now pre-filtered so you can review the cited scene/event first, then expand into the full explorer only if needed.'
            : 'Inspect extracted events as ordered narrative nodes with temporal edges and inferred state-change overlays. This page is intentionally textual-first so chronology and evidence remain easy to audit.'}
        </p>
      </section>

      {!summary.available || !traceRows.available ? (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h2>Trace Artifacts Missing</h2>
          <p className="muted">Run the event extraction and temporal/state graph generators before using this page.</p>
          <ul className="list">
            <li>
              <span className="mono">python3 scripts/build_graphs.py --temporal-only</span>
            </li>
            <li>
              <span className="mono">python3 scripts/infer_state_changes.py</span>
            </li>
          </ul>
          {summary.missingFiles?.length ? (
            <ul className="list" style={{ marginTop: '0.75rem' }}>
              {summary.missingFiles.map((file) => (
                <li key={file}>
                  Missing: <span className="mono">{file}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : (
        <>
          {isEvidenceFocus ? (
            <section className="card trace-focus-review" style={{ marginTop: '1rem' }} aria-label="Focused evidence review">
              <div className="trace-focus-header">
                <div>
                  <p className="eyebrow" style={{ marginBottom: '0.35rem' }}>
                    Start Here
                  </p>
                  <h2 style={{ marginBottom: '0.35rem' }}>{focusTitle}</h2>
                  <p className="muted" style={{ margin: 0 }}>
                    Read the highlighted row(s) first, then scan the same-scene events/state overlays below for context.
                  </p>
                </div>
                <div className="trace-focus-stats mono">
                  <div>scene: {focusedSceneId || '-'}</div>
                  {eventId ? <div>event: {eventId}</div> : null}
                  {stateChangeId ? <div>state: {stateChangeId}</div> : null}
                </div>
              </div>

              <div className="trace-focus-grid">
                <div className="trace-focus-card">
                  <h3>Focus Context</h3>
                  {focusedScene ? (
                    <>
                      <p style={{ margin: '0 0 0.35rem' }}>
                        <strong>{focusedScene.headerRaw}</strong>
                      </p>
                      <p className="muted mono" style={{ margin: 0 }}>
                        {focusedScene.sceneId} | scene #{focusedScene.sceneIndex} | year {focusedScene.yearExplicit ?? focusedScene.yearInferred ?? '-'}
                      </p>
                    </>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      Scene context was not resolved from the incoming evidence link.
                    </p>
                  )}
                  {focusedEventRow ? (
                    <div className="trace-focus-note">
                      <strong>Event:</strong> <span className="mono">{focusedEventRow.event.eventTypeL2}</span> · {focusedEventRow.event.summary}
                    </div>
                  ) : null}
                  {focusedStateChangeRow ? (
                    <div className="trace-focus-note">
                      <strong>State change:</strong>{' '}
                      <span className="mono">
                        {focusedStateChangeRow.stateChange.stateDimension}:{focusedStateChangeRow.stateChange.direction}
                      </span>{' '}
                      ({focusedStateChangeRow.stateChange.claimType}, conf {focusedStateChangeRow.stateChange.confidence.toFixed(2)})
                    </div>
                  ) : null}
                </div>

                <div className="trace-focus-card">
                  <h3>How To Read This</h3>
                  <ol className="list">
                    <li>Start with the highlighted event/state row in the table.</li>
                    <li>Read other rows from the same scene for local narrative context.</li>
                    <li>Use Timeline for full scene blocks if you need screenplay-level audit detail.</li>
                  </ol>
                  <div className="pill-row" style={{ marginTop: '0.6rem' }}>
                    <Link
                      className="button secondary"
                      href={buildHref('/timeline', {
                        q: eventId || stateChangeId || focusedSceneId || q,
                        pair: pair || undefined,
                      })}
                    >
                      Open Timeline Audit
                    </Link>
                    <Link className="button secondary" href="/trace">
                      Open Full Trace Explorer
                    </Link>
                  </div>
                </div>
              </div>

              <div className="trace-focus-meta muted">
                Same-scene context loaded: {focusedSceneEvents.length} event row(s), {focusedSceneStateChanges.length} state-change row(s).
              </div>
            </section>
          ) : null}

          {!isEvidenceFocus ? (
            <section className="grid" aria-label="Trace summary panels">
            <article className="card">
              <h2>NCG Summary</h2>
              <dl className="kv">
                <dt>Events</dt>
                <dd>{summary.eventCount}</dd>
                <dt>Temporal Edges</dt>
                <dd>{summary.temporalEdgeCount}</dd>
                <dt>State Changes</dt>
                <dd>{summary.stateChangeCount}</dd>
                <dt>Scenes</dt>
                <dd>{summary.sceneCount}</dd>
              </dl>
            </article>

            <article className="card">
              <h2>Core Pair Focus</h2>
              <div className="pill-row">
                {CORE_PAIR_PRESETS.map((preset) => (
                  <Link
                    key={preset.value}
                    className={`pill ${pair === preset.value ? 'active' : ''}`}
                    href={buildHref('/trace', { q, entityId, eventType, year: yearRaw, pair: preset.value, locationQ })}
                  >
                    {preset.label}
                  </Link>
                ))}
              </div>
              <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                Core demo checks use distinct trajectories for Frank-Peggy, Frank-Hoffa, and Frank-Russell.
              </p>
            </article>

            <article className="card">
              <h2>APIs + Views</h2>
              <ul className="list">
                <li>
                  <span className="mono">/api/trace/timeline?pair=char_frank_sheeran::char_peggy_sheeran</span>
                </li>
                <li>
                  <span className="mono">/api/trace/state-changes?subjectId=char_peggy_sheeran&amp;objectId=char_frank_sheeran</span>
                </li>
                <li>
                  <Link href="/timeline">Open scene-ordered timeline view</Link>
                </li>
              </ul>
            </article>
            </section>
          ) : null}

          {!isEvidenceFocus ? (
            <section className="card" style={{ marginTop: '1rem' }}>
            <h2 className="section-title">NCG Filters</h2>
            <form method="get" action="/trace" className="toolbar">
              <div className="field">
                <label htmlFor="q">Search</label>
                <input id="q" name="q" defaultValue={q} placeholder="summary, evidence snippet, event id" />
              </div>
              <div className="field">
                <label htmlFor="entityId">Character / Entity</label>
                <select id="entityId" name="entityId" defaultValue={entityId}>
                  <option value="">All</option>
                  {traceRows.entityOptions.slice(0, 220).map((entity) => (
                    <option key={entity.entityId} value={entity.entityId}>
                      {entity.canonicalName} ({entity.entityType})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="eventType">Event Type</label>
                <select id="eventType" name="eventType" defaultValue={eventType}>
                  <option value="">All</option>
                  {traceRows.eventTypeOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="year">Year</label>
                <select id="year" name="year" defaultValue={yearRaw}>
                  <option value="">All</option>
                  {traceRows.yearOptions.map((value) => (
                    <option key={value} value={String(value)}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pair">Relationship Pair</label>
                <select id="pair" name="pair" defaultValue={pair}>
                  <option value="">All</option>
                  {traceRows.pairOptions.slice(0, 50).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="locationQ">Location Filter</label>
                <input id="locationQ" name="locationQ" defaultValue={locationQ} placeholder="Detroit, assisted living, casino…" />
              </div>
              <button type="submit" className="button">
                Apply
              </button>
              <Link className="button secondary" href="/trace">
                Reset
              </Link>
            </form>
            </section>
          ) : null}

          <section className="split" style={{ marginTop: '1rem' }}>
            <article className="card">
              <h2>{isEvidenceFocus ? 'Focused Events + Temporal Context' : 'Event Nodes + Temporal Edges'}</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                {isEvidenceFocus
                  ? `Showing ${traceRows.items.length} event row(s) in the focused context. Highlighted rows match the evidence link you clicked.`
                  : `Showing ${traceRows.items.length} of ${traceRows.filtered} matching events (${traceRows.total} total). Sequence and scene references are preserved from the event extraction output.`}
              </p>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Scene / Seq</th>
                      <th>Event</th>
                      <th>Participants</th>
                      <th>Temporal Edges</th>
                      <th>State Overlay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traceRows.items.map((row) => {
                      const isPrimaryFocusEvent = Boolean(eventId && row.event.eventId === eventId);
                      const isFocusedSceneRow = Boolean(focusedSceneId && row.event.sceneId === focusedSceneId);
                      const evidenceSnippet = Array.isArray(row.event.metadata.evidence_spans)
                        ? String((row.event.metadata.evidence_spans[0] as Record<string, unknown> | undefined)?.snippet ?? '')
                        : '';
                      return (
                        <tr
                          key={row.event.eventId}
                          id={`trace-event-${row.event.eventId}`}
                          className={[
                            isPrimaryFocusEvent ? 'trace-row-primary-focus' : '',
                            !isPrimaryFocusEvent && isEvidenceFocus && isFocusedSceneRow ? 'trace-row-scene-focus' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <td>
                            <div className="mono">{row.event.eventId}</div>
                            <div>
                              {row.event.sceneId} / {row.event.sequenceInScene}
                            </div>
                            {row.scene ? (
                              <>
                                <div className="muted" style={{ marginTop: '0.2rem' }}>
                                  {row.scene.headerRaw}
                                </div>
                                <div className="muted mono">
                                  year {row.scene.yearExplicit ?? row.scene.yearInferred ?? '-'}
                                </div>
                              </>
                            ) : null}
                          </td>
                          <td>
                            <div className="mono">{row.event.eventTypeL2}</div>
                            <div className="muted mono" style={{ marginTop: '0.25rem' }}>
                              {row.event.eventTypeL1}
                            </div>
                            <div style={{ marginTop: '0.3rem' }}>{row.event.summary}</div>
                            {evidenceSnippet ? (
                              <div className="muted" style={{ marginTop: '0.35rem' }}>
                                "{evidenceSnippet.slice(0, 170)}
                                {evidenceSnippet.length > 170 ? '...' : ''}"
                              </div>
                            ) : null}
                          </td>
                          <td>
                            {row.participants.length ? (
                              <ul className="list">
                                {row.participants.slice(0, 6).map((p) => (
                                  <li key={`${row.event.eventId}-${p.entityId}-${p.role}`}>
                                    <span className="mono">{p.role}</span>: {p.canonicalName ?? p.entityId}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="muted">-</span>
                            )}
                          </td>
                          <td>
                            <div className="muted" style={{ marginBottom: '0.25rem' }}>
                              in {row.incomingTemporal.length} / out {row.outgoingTemporal.length}
                            </div>
                            <ul className="list">
                              {row.incomingTemporal.slice(0, 2).map((edge) => (
                                <li key={edge.temporalEdgeId}>
                                  <span className="mono">{edge.relation}</span> from{' '}
                                  <span className="mono">{edge.fromEventId}</span>
                                </li>
                              ))}
                              {row.outgoingTemporal.slice(0, 2).map((edge) => (
                                <li key={edge.temporalEdgeId}>
                                  <span className="mono">{edge.relation}</span> to <span className="mono">{edge.toEventId}</span>
                                </li>
                              ))}
                              {row.incomingTemporal.length + row.outgoingTemporal.length === 0 ? <li className="muted">No temporal edges</li> : null}
                            </ul>
                          </td>
                          <td>
                            {row.stateChangesTriggered.length ? (
                              <ul className="list">
                                {row.stateChangesTriggered.map((sc) => (
                                  <li key={sc.stateChangeId}>
                                    <span className={`badge ${sc.claimType === 'explicit' ? 'explicit' : 'inferred'}`}>{sc.claimType}</span>{' '}
                                    <span className="mono">
                                      {sc.stateDimension}:{sc.direction}
                                    </span>
                                    <div className="muted" style={{ marginTop: '0.15rem' }}>
                                      {sc.subjectName ?? sc.subjectId} {'->'} {sc.objectName ?? sc.objectId} (conf {sc.confidence.toFixed(2)})
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="muted">No state overlay</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {traceRows.items.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          No events match the current filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <h2>{isEvidenceFocus ? 'State-Change Context (Same Filters)' : 'State-Change Overlay (Filtered)'}</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Showing {stateChangesOverlay.items.length} of {stateChangesOverlay.filtered} matching state changes ({stateChangesOverlay.total}{' '}
                total).
              </p>
              <div className="pill-row" style={{ marginBottom: '0.75rem' }}>
                <span className="badge explicit">explicit</span>
                <span className="badge inferred">inferred</span>
              </div>
              <ul className="list">
                {stateChangesOverlay.items.map((item) => {
                  const isPrimaryFocusState = Boolean(stateChangeId && item.stateChange.stateChangeId === stateChangeId);
                  const isFocusedSceneState = Boolean(focusedSceneId && item.stateChange.sceneId === focusedSceneId);
                  return (
                    <li
                      key={item.stateChange.stateChangeId}
                      id={`trace-state-${item.stateChange.stateChangeId}`}
                      className={[
                        isPrimaryFocusState ? 'trace-state-primary-focus' : '',
                        !isPrimaryFocusState && isEvidenceFocus && isFocusedSceneState ? 'trace-state-scene-focus' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div>
                        <span className={`badge ${item.stateChange.claimType === 'explicit' ? 'explicit' : 'inferred'}`}>
                          {item.stateChange.claimType}
                        </span>{' '}
                        <span className="mono">
                          {item.stateChange.stateDimension}:{item.stateChange.direction}
                        </span>
                      </div>
                      <div style={{ marginTop: '0.2rem' }}>
                        {(item.subject?.canonicalName ?? item.stateChange.subjectId) + ' -> ' + (item.object?.canonicalName ?? item.stateChange.objectId)}
                      </div>
                      <div className="muted mono" style={{ marginTop: '0.2rem' }}>
                        {item.stateChange.stateChangeId} | {item.stateChange.sceneId} | conf {item.stateChange.confidence.toFixed(2)}
                      </div>
                      {item.scene ? (
                        <div className="muted" style={{ marginTop: '0.15rem' }}>
                          {item.scene.headerRaw}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                {stateChangesOverlay.items.length === 0 ? <li className="muted">No state changes match current pair/entity filters.</li> : null}
              </ul>
            </article>
          </section>
        </>
      )}
    </main>
  );
}
