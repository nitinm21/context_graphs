import Link from 'next/link';

import { getEntityNeighbors, getKgSummary, listEntities } from '@/lib/kgData';

const FOCUS_PRESETS = [
  { entityId: 'char_frank_sheeran', label: 'Frank' },
  { entityId: 'char_jimmy_hoffa', label: 'Hoffa' },
  { entityId: 'char_russell_bufalino', label: 'Russell' },
  { entityId: 'char_peggy_sheeran', label: 'Peggy' },
] as const;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type EntityTypeFilter = 'all' | 'character' | 'group' | 'organization' | 'location' | 'object';

function getSingle(params: Record<string, string | string[] | undefined>, key: string): string | null {
  const value = params[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function hrefWithEntity(entityId: string, q: string, type: string): string {
  const search = new URLSearchParams();
  search.set('entityId', entityId);
  if (q) search.set('q', q);
  if (type && type !== 'all') search.set('type', type);
  return `/kg?${search.toString()}`;
}

export default async function KgPage({ searchParams }: PageProps) {
  const params = (searchParams ? await searchParams : {}) ?? {};
  const q = (getSingle(params, 'q') ?? '').trim();
  const typeRaw = (getSingle(params, 'type') ?? 'all').trim();
  const type: EntityTypeFilter = (
    ['all', 'character', 'group', 'organization', 'location', 'object'].includes(typeRaw)
      ? typeRaw
      : 'all'
  ) as EntityTypeFilter;
  const requestedEntityId = (getSingle(params, 'entityId') ?? '').trim();

  const [summary, entitiesResult, characterSuggestions] = await Promise.all([
    getKgSummary(),
    listEntities({ q, type, limit: 120 }),
    listEntities({ type: 'character', limit: 300 }),
  ]);

  const fallbackEntityId = requestedEntityId || FOCUS_PRESETS[0].entityId;
  const neighborhood = await getEntityNeighbors(fallbackEntityId);
  const selectedEntityId = neighborhood.entity?.entityId ?? requestedEntityId ?? '';

  return (
    <main id="main-content">
      <section className="hero" aria-labelledby="kg-title">
        <p className="eyebrow">Knowledge Graph View</p>
        <h1 id="kg-title">KG Browser</h1>
        <p className="subtitle">
          Browse canonical entities and static/semi-stable relationships derived from parser artifacts plus manual
          alias/relationship rules for the Irishman demo.
        </p>
      </section>

      {!summary.available ? (
        <section className="card" style={{ marginTop: '1rem' }}>
          <h2>KG Artifacts Missing</h2>
          <p className="muted">
            Run the entity + KG build steps before using this page.
          </p>
          <ul className="list">
            <li>
              <span className="mono">python3 scripts/build_entities.py</span>
            </li>
            <li>
              <span className="mono">python3 scripts/build_graphs.py --kg-only</span>
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
          <section className="grid" aria-label="KG summary panels">
            <article className="card">
              <h2>Graph Summary</h2>
              <dl className="kv">
                <dt>Entities</dt>
                <dd>{summary.entityCount}</dd>
                <dt>KG Edges</dt>
                <dd>{summary.edgeCount}</dd>
                <dt>Predicates</dt>
                <dd>{Object.keys(summary.predicateCounts).length}</dd>
              </dl>
            </article>

            <article className="card">
              <h2>Focus Presets</h2>
              <div className="pill-row">
                {FOCUS_PRESETS.map((preset) => (
                  <Link
                    key={preset.entityId}
                    className={`pill ${selectedEntityId === preset.entityId ? 'active' : ''}`}
                    href={hrefWithEntity(preset.entityId, q, type)}
                  >
                    {preset.label}
                  </Link>
                ))}
              </div>
              <p className="muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                Core review targets: Frank, Hoffa, Russell, Peggy.
              </p>
            </article>

            <article className="card">
              <h2>API Endpoints</h2>
              <ul className="list">
                <li>
                  <span className="mono">/api/entities?type=character&amp;limit=25</span>
                </li>
                <li>
                  <span className="mono">/api/kg/neighbors?entityId=char_frank_sheeran</span>
                </li>
              </ul>
            </article>
          </section>

          <section className="card" style={{ marginTop: '1rem' }}>
            <h2 className="section-title">Browse Entities</h2>
            <form method="get" className="toolbar" action="/kg">
              <div className="field">
                <label htmlFor="q">Search</label>
                <input
                  id="q"
                  name="q"
                  defaultValue={q}
                  placeholder={type === 'character' ? 'Start typing a character name…' : 'Frank, Teamsters, FBI…'}
                  list={characterSuggestions.available ? 'kg-character-name-suggestions' : undefined}
                  autoComplete="off"
                />
                {characterSuggestions.available ? (
                  <datalist id="kg-character-name-suggestions">
                    {characterSuggestions.items.map((entity) => (
                      <option key={entity.entityId} value={entity.canonicalName} />
                    ))}
                  </datalist>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="type">Entity Type</label>
                <select id="type" name="type" defaultValue={type || 'all'}>
                  <option value="all">All</option>
                  <option value="character">Character</option>
                  <option value="group">Group</option>
                  <option value="organization">Organization</option>
                  <option value="location">Location</option>
                </select>
              </div>
              {selectedEntityId ? <input type="hidden" name="entityId" value={selectedEntityId} /> : null}
              <button className="button" type="submit">
                Filter
              </button>
              <Link className="button secondary" href="/kg">
                Reset
              </Link>
            </form>
            <p className="muted" style={{ marginBottom: 0 }}>
              Showing {entitiesResult.items.length} of {entitiesResult.filtered} matching entities ({entitiesResult.total}{' '}
              total).
            </p>
            {type === 'character' && characterSuggestions.available ? (
              <p className="muted" style={{ marginTop: '0.45rem', marginBottom: 0 }}>
                Character autocomplete is enabled. Start typing and pick a name from the suggestions.
              </p>
            ) : null}
          </section>

          <section className="split" style={{ marginTop: '1rem' }}>
            <article className="card">
              <h2>Entity List</h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Entity</th>
                      <th>Type</th>
                      <th>First Scene</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entitiesResult.items.map((entity) => (
                      <tr key={entity.entityId}>
                        <td>
                          <Link
                            href={hrefWithEntity(entity.entityId, q, type)}
                            className={selectedEntityId === entity.entityId ? 'pill active' : 'pill'}
                          >
                            {entity.canonicalName}
                          </Link>
                          <div className="muted mono" style={{ marginTop: '0.25rem' }}>
                            {entity.entityId}
                          </div>
                        </td>
                        <td>{entity.entityType}</td>
                        <td>{entity.firstSceneId ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="card">
              <h2>Neighbors / Edge Labels</h2>
              {!neighborhood.entity ? (
                <p className="muted">
                  Select an entity from the list or a focus preset to inspect its KG neighborhood.
                </p>
              ) : (
                <>
                  <p style={{ marginTop: 0 }}>
                    <strong>{neighborhood.entity.canonicalName}</strong>{' '}
                    <span className="muted">({neighborhood.entity.entityType})</span>
                  </p>
                  <p className="muted" style={{ marginTop: '-0.25rem' }}>
                    {neighborhood.entity.entityId}
                  </p>
                  {neighborhood.entity.aliases.length ? (
                    <div className="pill-row" style={{ marginBottom: '0.75rem' }}>
                      {neighborhood.entity.aliases.slice(0, 12).map((alias) => (
                        <span className="pill" key={alias}>
                          {alias}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Dir</th>
                          <th>Predicate</th>
                          <th>Neighbor</th>
                          <th>Stability</th>
                        </tr>
                      </thead>
                      <tbody>
                        {neighborhood.neighbors.map((row) => (
                          <tr key={row.edge.edgeId}>
                            <td>{row.direction === 'outgoing' ? 'out' : 'in'}</td>
                            <td>
                              <span className="mono">{row.edge.predicate}</span>
                            </td>
                            <td>
                              {row.neighbor ? (
                                <Link href={hrefWithEntity(row.neighbor.entityId, q, type)}>
                                  {row.neighbor.canonicalName}
                                </Link>
                              ) : (
                                <span className="mono">{row.direction === 'outgoing' ? row.edge.objectId : row.edge.subjectId}</span>
                              )}
                              <div className="muted mono" style={{ marginTop: '0.2rem' }}>
                                {row.edge.edgeId}
                              </div>
                            </td>
                            <td>{row.edge.stability}</td>
                          </tr>
                        ))}
                        {neighborhood.neighbors.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="muted">
                              No KG edges found for this entity.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </article>
          </section>
        </>
      )}
    </main>
  );
}
