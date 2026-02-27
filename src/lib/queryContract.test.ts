import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeQueryRequest,
  toApiQueryResponse,
  validateApiQueryResponse,
  type QueryResponse,
} from './queryContract.ts';

test('normalizeQueryRequest parses snake_case request', () => {
  const parsed = normalizeQueryRequest({
    question: "How does Peggy's relationship with Frank change over time?",
    preferred_mode: 'auto',
    include_evidence: true,
    include_baseline_comparison: true,
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.value.preferredMode, 'auto');
    assert.equal(parsed.value.includeEvidence, true);
    assert.equal(parsed.value.includeBaselineComparison, true);
  }
});

test('normalizeQueryRequest rejects missing question', () => {
  const parsed = normalizeQueryRequest({ preferred_mode: 'kg' });
  assert.equal(parsed.ok, false);
});

test('toApiQueryResponse + validateApiQueryResponse produce valid contract', () => {
  const response: QueryResponse = {
    question: 'Who are the key people connected to Frank Sheeran?',
    queryType: 'fact',
    modeUsed: 'kg',
    answerText: 'KG answer',
    confidence: 0.81,
    entitiesUsed: ['char_frank_sheeran', 'char_jimmy_hoffa'],
    eventsUsed: [],
    stateChangesUsed: [],
    evidenceRefs: ['scene:scene_0008'],
    reasoningNotes: 'Test reasoning.',
    baselineComparison: {
      queryType: 'fact',
      modeUsed: 'baseline_rag',
      answerText: 'Baseline answer',
      confidence: 0.33,
      entitiesUsed: ['char_frank_sheeran'],
      eventsUsed: ['evt_000123'],
      stateChangesUsed: [],
      evidenceRefs: ['evref_000123'],
      reasoningNotes: 'Baseline reasoning.',
    },
  };

  const apiPayload = toApiQueryResponse(response);
  const validation = validateApiQueryResponse(apiPayload);
  assert.equal(validation.ok, true);
  assert.equal(apiPayload.query_type, 'fact');
  assert.equal(apiPayload.mode_used, 'kg');
  assert.equal(apiPayload.baseline_comparison?.mode_used, 'baseline_rag');
});

test('validateApiQueryResponse rejects malformed payload', () => {
  const validation = validateApiQueryResponse({
    question: 'x',
    query_type: 'fact',
    mode_used: 'kg',
    answer_text: 'x',
    confidence: 1.2,
    entities_used: [],
    events_used: [],
    state_changes_used: [],
    evidence_refs: [],
    reasoning_notes: 'x',
    baseline_comparison: null,
  });
  assert.equal(validation.ok, false);
});
