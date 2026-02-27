import Link from 'next/link';

export default function AboutPage() {
  return (
    <main id="main-content">
      <section className="hero" aria-labelledby="about-title">
        <p className="eyebrow">About / Methodology</p>
        <h1 id="about-title">What This Demo Is Showing</h1>
        <p className="subtitle">
          This project demonstrates why structured graph representations of narrative context can answer some questions more transparently than chunk retrieval alone.
        </p>
      </section>

      <section className="grid" style={{ marginTop: '1rem' }} aria-label="Core concepts">
        <article className="card">
          <h2>Knowledge Graph (KG)</h2>
          <p className="muted">
            The KG stores canonical entities (people, groups, organizations, locations) and labeled relationships. It is best for structural facts and neighborhood queries.
          </p>
          <ul className="list">
            <li>Examples: family ties, associations, organizational links</li>
            <li>Strong at “Who is connected to Frank Sheeran?”</li>
            <li>Not enough alone for relationship trajectories over time</li>
          </ul>
        </article>

        <article className="card">
          <h2>Narrative Context Graph (NCG)</h2>
          <p className="muted">
            The NCG models extracted events in scene order, temporal edges between events, and inferred state changes (for example trust/fear/distance shifts between characters).
          </p>
          <ul className="list">
            <li>Best for timeline, causal-chain, and state-change questions</li>
            <li>Maintains explicit vs inferred claim labeling</li>
            <li>Preserves evidence references back to screenplay-derived artifacts</li>
          </ul>
        </article>

        <article className="card">
          <h2>Baseline Retrieval (RAG-style Foil)</h2>
          <p className="muted">
            The baseline intentionally uses simple lexical retrieval over local text-like artifacts to provide a comparison target. It is not the primary system.
          </p>
          <ul className="list">
            <li>Ranks chunks by overlap with the question</li>
            <li>Can surface relevant text but may miss sequence/state structure</li>
            <li>Useful for showing why graph-backed answers differ</li>
          </ul>
        </article>
      </section>

      <section className="split" style={{ marginTop: '1rem' }}>
        <article className="card">
          <h2>Why The Peggy/Frank Query Matters</h2>
          <p className="muted">
            “How does Peggy’s relationship with Frank change over time?” is a strong demo query because it requires chronology plus relational interpretation.
          </p>
          <ul className="list">
            <li>KG alone can identify the pair, but not the trajectory</li>
            <li>NCG can surface ordered events and inferred state changes</li>
            <li>Evidence links let a reviewer inspect supporting scenes directly</li>
          </ul>
          <p>
            Try it on the <Link href="/">home page</Link> and then inspect evidence rows in <Link href="/trace">/trace</Link> and <Link href="/timeline">/timeline</Link>.
          </p>
        </article>

        <article className="card">
          <h2>Limitations / Scope</h2>
          <ul className="list">
            <li>This is a deterministic MVP with heuristic extraction and inference rules.</li>
            <li>State-change claims are labeled `explicit` vs `inferred`; inferred claims are not ground-truth facts.</li>
            <li>KG evidence refs are still placeholders in some early graph edges (scene-level references).</li>
            <li>OpenAI-assisted synthesis/refinement is optional and not required for the core flows.</li>
          </ul>
        </article>
      </section>

    </main>
  );
}
