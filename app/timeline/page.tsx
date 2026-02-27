import Link from 'next/link';

import { getTimelineSlice } from '@/lib/ntgData';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const CORE_PAIR_PRESETS = [
  { value: 'char_frank_sheeran::char_peggy_sheeran', label: 'Frank <> Peggy' },
  { value: 'char_frank_sheeran::char_jimmy_hoffa', label: 'Frank <> Hoffa' },
  { value: 'char_frank_sheeran::char_russell_bufalino', label: 'Frank <> Russell' },
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

function toYear(input: string): number | undefined {
  if (!input.trim()) return undefined;
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default async function TimelinePage({ searchParams }: PageProps) {
  const params = (searchParams ? await searchParams : {}) ?? {};
  const q = getSingle(params, 'q').trim();
  const entityId = getSingle(params, 'entityId').trim();
  const eventType = getSingle(params, 'eventType').trim();
  const pair = getSingle(params, 'pair').trim();
  const yearRaw = getSingle(params, 'year').trim();
  const year = toYear(yearRaw);

  const result = await getTimelineSlice({
    q,
    entityId,
    eventType,
    pair,
    year,
    includeBlocks: true,
    limitScenes: 24,
  });

  const entityNameById = new Map(result.available ? result.entityOptions.map((e) => [e.entityId, e.canonicalName]) : []);

  return (
    <main id="main-content">
      <section className="hero" aria-labelledby="timeline-title">
        <p className="eyebrow">Timeline View</p>
        <h1 id="timeline-title">Scene-Ordered Timeline Audit</h1>
        <p className="subtitle">
          Browse scenes in screenplay order with filters for year, character, event type, and relationship pair. Expand a scene
          to inspect source script blocks alongside extracted events and inferred state changes.
        </p>
      </section>

      {!result.available ? (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h2>Timeline Artifacts Missing</h2>
          <ul className="list">
            <li>
              <span className="mono">python3 scripts/build_graphs.py --temporal-only</span>
            </li>
            <li>
              <span className="mono">python3 scripts/infer_state_changes.py</span>
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
          <section className="grid" aria-label="Timeline summary panels">
            <article className="card">
              <h2>Timeline Summary</h2>
              <dl className="kv">
                <dt>Scenes (total)</dt>
                <dd>{result.totalScenes}</dd>
                <dt>Scenes (shown)</dt>
                <dd>{result.filteredScenes}</dd>
                <dt>Events (total)</dt>
                <dd>{result.totalEvents}</dd>
                <dt>Pair Filters</dt>
                <dd>{result.pairOptions.length}</dd>
              </dl>
            </article>

            <article className="card">
              <h2>Core Pair Focus</h2>
              <div className="pill-row">
                {CORE_PAIR_PRESETS.map((preset) => (
                  <Link
                    key={preset.value}
                    className={`pill ${pair === preset.value ? 'active' : ''}`}
                    href={buildHref('/timeline', { q, entityId, eventType, pair: preset.value, year: yearRaw })}
                  >
                    {preset.label}
                  </Link>
                ))}
              </div>
              <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                Use these to inspect distinct trajectories across scenes for the core relationship demo checks.
              </p>
            </article>

            <article className="card">
              <h2>API Endpoint</h2>
              <ul className="list">
                <li>
                  <span className="mono">
                    /api/trace/timeline?year=1975&amp;pair=char_frank_sheeran::char_peggy_sheeran&amp;includeBlocks=1
                  </span>
                </li>
                <li>
                  <Link href="/trace">Open NCG event/edge explorer</Link>
                </li>
              </ul>
            </article>
          </section>

          <section className="card" style={{ marginTop: '1rem' }}>
            <h2 className="section-title">Timeline Filters</h2>
            <form method="get" action="/timeline" className="toolbar">
              <div className="field">
                <label htmlFor="q">Search</label>
                <input id="q" name="q" defaultValue={q} placeholder="event or state-change text" />
              </div>
              <div className="field">
                <label htmlFor="year">Year</label>
                <select id="year" name="year" defaultValue={yearRaw}>
                  <option value="">All</option>
                  {result.yearOptions.map((value) => (
                    <option key={value} value={String(value)}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="entityId">Character / Entity</label>
                <select id="entityId" name="entityId" defaultValue={entityId}>
                  <option value="">All</option>
                  {result.entityOptions.slice(0, 220).map((entity) => (
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
                  {result.eventTypeOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="pair">Relationship Pair</label>
                <select id="pair" name="pair" defaultValue={pair}>
                  <option value="">All</option>
                  {result.pairOptions.slice(0, 50).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="button">
                Apply
              </button>
              <Link className="button secondary" href="/timeline">
                Reset
              </Link>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}>
              Showing up to 24 scenes. Scene filters match extracted events and inferred state changes; expanded scenes still show
              full script blocks and extracted events for auditability.
            </p>
          </section>

          <section style={{ marginTop: '1rem', display: 'grid', gap: '0.9rem' }}>
            {result.scenes.map((row, index) => {
              const triggerCounts = new Map<string, number>();
              for (const sc of row.stateChanges) {
                for (const eventId of sc.triggerEventIds) {
                  triggerCounts.set(eventId, (triggerCounts.get(eventId) ?? 0) + 1);
                }
              }
              const matchingStateChanges = row.stateChanges.filter((sc) => {
                if (pair && [sc.subjectId, sc.objectId].sort().join('::') !== pair) return false;
                if (entityId && sc.subjectId !== entityId && sc.objectId !== entityId) return false;
                if (q) {
                  const text = `${sc.stateDimension} ${sc.direction} ${sc.claimType}`.toLowerCase();
                  if (!text.includes(q.toLowerCase())) return false;
                }
                return true;
              });

              return (
                <details key={row.scene.sceneId} className="card scene-detail" open={index < 2}>
                  <summary className="scene-summary">
                    <span>
                      <span className="mono">{row.scene.sceneId}</span>
                      {' | '}
                      {row.scene.headerRaw}
                    </span>
                    <span className="muted">
                      year {row.year ?? '-'} | events {row.events.length}
                      {q || entityId || eventType || pair ? ` (matched ${row.matchingEventCount})` : ''}
                      {' | '}state changes {row.stateChanges.length}
                      {q || entityId || eventType || pair ? ` (matched ${row.matchingStateChangeCount})` : ''}
                    </span>
                  </summary>

                  <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.9rem' }}>
                    <div className="grid" style={{ marginTop: 0 }}>
                      <article className="card" style={{ padding: '0.85rem' }}>
                        <h2 style={{ marginTop: 0 }}>Scene Metadata</h2>
                        <dl className="kv">
                          <dt>Location</dt>
                          <dd>{row.scene.locationRaw || '-'}</dd>
                          <dt>Time of Day</dt>
                          <dd>{row.scene.timeOfDay ?? '-'}</dd>
                          <dt>Explicit Year</dt>
                          <dd>{row.scene.yearExplicit ?? '-'}</dd>
                          <dt>Inferred Year</dt>
                          <dd>{row.scene.yearInferred ?? '-'}</dd>
                        </dl>
                      </article>

                      <article className="card" style={{ padding: '0.85rem' }}>
                        <h2 style={{ marginTop: 0 }}>State Changes In Scene</h2>
                        {row.stateChanges.length ? (
                          <ul className="list">
                            {row.stateChanges.map((sc) => {
                              const subjectName = entityNameById.get(sc.subjectId) ?? sc.subjectId;
                              const objectName = entityNameById.get(sc.objectId) ?? sc.objectId;
                              const isMatched = matchingStateChanges.some((m) => m.stateChangeId === sc.stateChangeId);
                              return (
                                <li key={sc.stateChangeId} style={{ opacity: !q && !pair && !entityId ? 1 : isMatched ? 1 : 0.65 }}>
                                  <span className={`badge ${sc.claimType === 'explicit' ? 'explicit' : 'inferred'}`}>{sc.claimType}</span>{' '}
                                  <span className="mono">
                                    {sc.stateDimension}:{sc.direction}
                                  </span>
                                  <div style={{ marginTop: '0.2rem' }}>
                                    {subjectName} {'->'} {objectName}
                                  </div>
                                  <div className="muted mono" style={{ marginTop: '0.15rem' }}>
                                    {sc.stateChangeId} | conf {sc.confidence.toFixed(2)} | triggers {sc.triggerEventIds.length}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className="muted" style={{ marginBottom: 0 }}>
                            No inferred state changes for this scene.
                          </p>
                        )}
                      </article>
                    </div>

                    <article className="card" style={{ padding: '0.85rem' }}>
                      <h2 style={{ marginTop: 0 }}>Extracted Events</h2>
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Seq</th>
                              <th>Type</th>
                              <th>Summary</th>
                              <th>Participants</th>
                              <th>Overlay</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.events.map((event) => {
                              const eventMatched =
                                (!eventType || event.eventTypeL2 === eventType) &&
                                (!entityId || event.participants.some((p) => p.entityId === entityId)) &&
                                (!pair ||
                                  (() => {
                                    const ids = Array.from(new Set(event.participants.map((p) => p.entityId)));
                                    for (let i = 0; i < ids.length; i += 1) {
                                      for (let j = i + 1; j < ids.length; j += 1) {
                                        if ([ids[i], ids[j]].sort().join('::') === pair) return true;
                                      }
                                    }
                                    return false;
                                  })());

                              return (
                                <tr key={event.eventId} style={{ opacity: !q && !entityId && !eventType && !pair ? 1 : eventMatched ? 1 : 0.65 }}>
                                  <td>
                                    <div>{event.sequenceInScene}</div>
                                    <div className="muted mono">{event.eventId}</div>
                                  </td>
                                  <td>
                                    <div className="mono">{event.eventTypeL2}</div>
                                    <div className="muted mono">{event.eventTypeL1}</div>
                                  </td>
                                  <td>{event.summary}</td>
                                  <td>
                                    {event.participants.length ? (
                                      <ul className="list">
                                        {event.participants.slice(0, 4).map((p) => (
                                          <li key={`${event.eventId}-${p.entityId}-${p.role}`}>
                                            <span className="mono">{p.role}</span>: {entityNameById.get(p.entityId) ?? p.entityId}
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <span className="muted">-</span>
                                    )}
                                  </td>
                                  <td>
                                    {triggerCounts.has(event.eventId) ? (
                                      <span className="badge">{triggerCounts.get(event.eventId)} state change(s)</span>
                                    ) : (
                                      <span className="muted">-</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </article>

                    <article className="card" style={{ padding: '0.85rem' }}>
                      <h2 style={{ marginTop: 0 }}>Scene Script Blocks (Utterances / Action Beats)</h2>
                      <p className="muted" style={{ marginTop: 0 }}>
                        Raw parser blocks are shown to support manual comparison against extracted events.
                      </p>
                      <div className="table-wrap">
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Seq</th>
                              <th>Block</th>
                              <th>Lines</th>
                              <th>Text</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.scriptBlocks.map((block) => (
                              <tr key={block.blockId}>
                                <td>
                                  {block.sequenceInScene}
                                  <div className="muted mono">{block.blockId}</div>
                                </td>
                                <td>
                                  <div className="mono">{block.blockType}</div>
                                  {block.speakerCueRaw ? <div className="muted">{block.speakerCueRaw}</div> : null}
                                </td>
                                <td className="mono">
                                  {block.lineStart}-{block.lineEnd}
                                </td>
                                <td>{block.text}</td>
                              </tr>
                            ))}
                            {row.scriptBlocks.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="muted">
                                  No script blocks found for this scene.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </article>
                  </div>
                </details>
              );
            })}
            {result.scenes.length === 0 ? (
              <section className="card">
                <h2>No Matching Scenes</h2>
                <p className="muted" style={{ marginBottom: 0 }}>
                  Adjust the year/entity/event/pair filters to broaden the timeline slice.
                </p>
              </section>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
