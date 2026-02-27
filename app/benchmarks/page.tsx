import { promises as fs } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';

import QueryWorkbench from '@/components/QueryWorkbench';
import type { BenchmarkFixture } from '@/components/QueryWorkbench';

async function loadFixtures(): Promise<BenchmarkFixture[]> {
  const filePath = path.join(process.cwd(), 'data', 'derived', 'query_examples.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { items?: unknown[] };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter((item): item is BenchmarkFixture => !!item && typeof item === 'object');
  } catch {
    return [];
  }
}

export default async function BenchmarksPage() {
  const fixtures = await loadFixtures();

  return (
    <main id="main-content">
      <section className="hero" aria-labelledby="benchmarks-title">
        <p className="eyebrow">Benchmarks</p>
        <h1 id="benchmarks-title">Benchmark Fixture Runner (Advanced)</h1>
        <p className="subtitle">
          Run curated fixtures, inspect router mode selection, and compare deterministic graph answers against the baseline retrieval answer.
        </p>
      </section>

      <QueryWorkbench
        fixtures={fixtures}
        initialQuestion={fixtures[0]?.question ?? 'Who are the key people connected to Frank Sheeran?'}
        initialIncludeBaselineComparison={Boolean(fixtures[0]?.include_baseline_comparison ?? true)}
        shellTitle="Fixture Runner"
        shellSubtitle="Select a fixture from the rail to prefill the query and execute the expected routing path."
      />

      <section className="card" style={{ marginTop: '1rem' }}>
        <div className="benchmark-rail-header">
          <h2>Fixture Index</h2>
          <Link href="/" className="button secondary">
            Back to Ask
          </Link>
          <Link href="/compare" className="button secondary">
            Compare Flow
          </Link>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fixture</th>
                <th>Question</th>
                <th>Expected Type</th>
                <th>Expected Mode</th>
                <th>Baseline?</th>
              </tr>
            </thead>
            <tbody>
              {fixtures.map((fixture) => (
                <tr key={fixture.query_id}>
                  <td className="mono">{fixture.query_id}</td>
                  <td>
                    <div>{fixture.question}</div>
                    {fixture.notes ? <div className="muted">{fixture.notes}</div> : null}
                  </td>
                  <td>
                    <span className="pill">{fixture.query_type_expected}</span>
                  </td>
                  <td>
                    <span className="pill">{fixture.mode_expected}</span>
                  </td>
                  <td>{fixture.include_baseline_comparison ? 'yes' : 'no'}</td>
                </tr>
              ))}
              {fixtures.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No benchmark fixtures found in `data/derived/query_examples.json`.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
