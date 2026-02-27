# Irishman Context Graphs

A local-first demo that parses *The Irishman* screenplay into deterministic graph artifacts and answers narrative questions using structured traversal plus evidence references. Built with **Next.js 15**, **React 19**, and **TypeScript**.

## What It Demonstrates

- Deterministic screenplay parsing into auditable intermediate artifacts (scenes, utterances, action beats)
- Entity canonicalization with manual alias overrides and a lightweight Knowledge Graph (KG)
- Event extraction, temporal edges, and relationship state-change inference (Narrative Trace Graph)
- OpenAI answer-text synthesis layered on top of structured outputs


## Project Structure

```
app/                    Next.js App Router pages + API routes
  api/
    dataset/            Dataset summary endpoint
    entities/           Entity lookup
    kg/                 Knowledge Graph query
    query/              Core query endpoint
      baseline-rag/     Baseline RAG comparator
      evidence/         Evidence retrieval
    trace/              Narrative trace data
src/
  components/           React components (QueryWorkbench, EvidencePanel, etc.)
  lib/                  Query router, answer builders, KG/NTG loaders, LLM client
    answers/            Structured answer builders per query mode
    llm/                Optional OpenAI synthesis client
  types/                Shared TypeScript types
scripts/                Python parser, build, eval, and validation tooling
config/                 Manual entity aliases, event taxonomy, state-change rules
data/
  raw/                  Source screenplay text
  intermediate/         Parser outputs (scenes, utterances, action beats)
  derived/              Graph, event, and query artifacts
  gold/                 Manual spot-check fixtures
  eval/                 Evaluation reports (parser quality, taxonomy coverage)
docs/                   Demo script, recruiter summary, evaluation notes, data contracts
public/characters/      Character portrait images
```

## Setup

### Prerequisites

- **Node.js ≥ 20** (see `engines` in `package.json`)
- **Python 3.10+** (for parser and evaluation scripts)

### Install

```bash
npm install
```

### Run the App

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

> **Tip:** `npm start` is also wired to `next dev` with hot reload. Use `npm run start:prod` only after `npm run build` to test the production server.

## NPM Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server (with `WATCHPACK_POLLING`) |
| `npm run dev:turbo` | Start dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run start:prod` | Start production server (requires prior build) |
| `npm run typecheck` | Run TypeScript type checking (`tsc --noEmit`) |
| `npm test` | Run unit tests (query router + query contract) |

## Pipeline Scripts (Python)

The data pipeline is a sequence of deterministic Python scripts:

```bash
# 1. Clean raw screenplay markdown
python3 scripts/clean_irishman_markdown.py

# 2. Parse into scenes, utterances, action beats
python3 scripts/parse_screenplay.py

# 3. Build canonical entity list
python3 scripts/build_entities.py

# 4. Extract events from parsed scenes
python3 scripts/extract_events.py

# 5. Infer relationship state changes
python3 scripts/infer_state_changes.py

# 6. Build KG + NTG graph artifacts
python3 scripts/build_graphs.py

# 7. (Optional) Refine event summaries with LLM
python3 scripts/refine_events_with_llm.py
```

## Verification & Evaluation

```bash
npm run typecheck
npm run build
npm test

# Validate generated artifacts against schema expectations
python3 scripts/validate_artifacts.py --phase 8

# Parser quality report
python3 scripts/eval_parser_quality.py

# Event taxonomy coverage report
python3 scripts/eval_taxonomy_coverage.py --release
```

Smoke-test queries against a running dev server:

```bash
python3 scripts/smoke_query_examples.py --base-url http://localhost:3000
# or
bash scripts/smoke_query_examples.sh
```

## Demo Flow (Quick Start)

1. Open `/` — the **Ask** page
2. Click a preset like *"Peggy ↔ Frank arc"* or type: `How does Peggy's relationship with Frank change over time?`
3. Inspect the routed mode, structured answer, and visual canvas
4. Toggle baseline comparison to see RAG vs. graph-backed answers
5. Open `/how-it-works` to explore each pipeline stage with live artifact counts

## Evaluation Artifacts

| File | Description |
|---|---|
| `data/eval/parser_quality_report.json` | Parser accuracy metrics |
| `data/eval/taxonomy_coverage_report.json` | Event taxonomy coverage |
| `data/eval/unmapped_events_review.json` | Unmapped events for manual review |
| `docs/evaluation.md` | Evaluation methodology and results |

## Optional OpenAI Integration

Create `.env` (see `.env.example`) and set:

```env
OPENAI_API_KEY=sk-...
ENABLE_LLM_SYNTHESIS=true        # Rewrite answer text while preserving structured evidence
ENABLE_LLM_EVENT_REVIEW=true     # Generate event-summary review sidecars
```

Additional configuration options (all optional):

```env
OPENAI_MODEL=gpt-4.1-mini        # Default model
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_MS=15000
OPENAI_MAX_OUTPUT_TOKENS=500
OPENAI_SYNTHESIS_TEMPERATURE=0.2
```

The deterministic pipeline remains the source of truth even when synthesis is enabled.

## Documentation

- [`docs/demo-script.md`](docs/demo-script.md) — Step-by-step demo walkthrough
- [`docs/recruiter-summary.md`](docs/recruiter-summary.md) — One-page recruiter summary
- [`docs/evaluation.md`](docs/evaluation.md) — Evaluation methodology and results
- [`docs/data-contracts.md`](docs/data-contracts.md) — Data schema contracts
