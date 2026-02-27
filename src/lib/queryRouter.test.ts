import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyQueryType, routeQuery, selectModeForQueryType } from './queryRouter.ts';

test('classifyQueryType: fact', () => {
  assert.equal(classifyQueryType('Who are the key people connected to Frank Sheeran?'), 'fact');
});

test('classifyQueryType: state_change', () => {
  assert.equal(classifyQueryType("How does Peggy's relationship with Frank change over time?"), 'state_change');
});

test('classifyQueryType: causal_chain', () => {
  assert.equal(classifyQueryType("What events lead up to Hoffa's disappearance?"), 'causal_chain');
});

test('classifyQueryType: evidence', () => {
  assert.equal(classifyQueryType('Show supporting scenes for that conclusion.'), 'evidence');
});

test('classifyQueryType: comparison', () => {
  assert.equal(classifyQueryType('Why is this not just RAG? Compare baseline vs graph.'), 'comparison');
});

test('selectModeForQueryType respects preferred mode override', () => {
  const selected = selectModeForQueryType('timeline', 'kg');
  assert.equal(selected.modeUsed, 'kg');
});

test('routeQuery defaults state-change queries to NTG', () => {
  const decision = routeQuery('How does Peggy relationship with Frank change over time?', { entityCount: 2 });
  assert.equal(decision.queryType, 'state_change');
  assert.equal(decision.modeUsed, 'ntg');
});

test('routeQuery defaults comparison queries to hybrid', () => {
  const decision = routeQuery('Compare KG and timeline answers for Jimmy Hoffa and Frank.', { entityCount: 2 });
  assert.equal(decision.queryType, 'comparison');
  assert.equal(decision.modeUsed, 'hybrid');
});
