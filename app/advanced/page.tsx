import Link from 'next/link';

const TOOLS = [
  {
    href: '/kg',
    title: 'KG Explorer',
    description: 'Browse entities, aliases, and neighborhood edges. Best for stable relationship structure.',
    audience: 'Entity/relationship inspection',
  },
  {
    href: '/trace',
    title: 'Trace / NCG Explorer',
    description: 'Inspect extracted events, temporal edges, and state-change overlays in the narrative context graph.',
    audience: 'Event + state-change analysis',
  },
  {
    href: '/timeline',
    title: 'Timeline Audit',
    description: 'Scene-ordered audit with script blocks, extracted events, and inferred state changes side-by-side.',
    audience: 'Evidence and chronology audit',
  },
  {
    href: '/benchmarks',
    title: 'Benchmark Fixture Runner',
    description: 'Run curated query fixtures and verify router behavior and comparison outputs.',
    audience: 'Regression / demo fixture runs',
  },
  {
    href: '/about',
    title: 'About / Methodology',
    description: 'Conceptual framing, limitations, and copyright / local-use notes.',
    audience: 'Supporting documentation',
  },
] as const;

export default function AdvancedPage() {
  return (
    <main id="main-content">
      <section className="hero hero-flow" aria-labelledby="advanced-title">
        <div className="hero-flow-main">
          <p className="eyebrow">Advanced</p>
          <h1 id="advanced-title">Power tools for deeper inspection and debugging.</h1>
          <p className="subtitle">
            The core recruiter story is <Link href="/">Ask</Link> → <Link href="/compare">Compare</Link> →{' '}
            <Link href="/how-it-works">How It Works</Link>. This page keeps the detailed explorers available for audits,
            debugging, and technical walkthroughs.
          </p>
        </div>
        <div className="hero-flow-side">
          <h2>When to use this page</h2>
          <ul className="list">
            <li>You want raw explorer filters and dense tables.</li>
            <li>You need to inspect scene-order chronology in depth.</li>
            <li>You are validating extraction / inference behavior against artifacts.</li>
          </ul>
        </div>
      </section>

      <section className="advanced-tool-grid" style={{ marginTop: '1rem' }} aria-label="Advanced tools">
        {TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} className="card advanced-tool-card">
            <div className="advanced-tool-top">
              <h2>{tool.title}</h2>
              <span className="mono advanced-tool-path">{tool.href}</span>
            </div>
            <p className="muted">{tool.description}</p>
            <p className="advanced-tool-audience">
              <strong>Best for:</strong> {tool.audience}
            </p>
          </Link>
        ))}
      </section>
    </main>
  );
}
