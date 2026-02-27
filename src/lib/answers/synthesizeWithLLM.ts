import type { StructuredAnswerCore } from '@/lib/queryContract';
import { normalizeStructuredAnswer } from '@/lib/queryContract';
import { getLlmSynthesisStatus } from '@/lib/llm/config';
import { generateOpenAIText } from '@/lib/llm/openaiClient';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3)).trimEnd()}...`;
}

function compactList(values: string[], limit: number): string {
  if (values.length === 0) return '(none)';
  const shown = values.slice(0, limit);
  const suffix = values.length > shown.length ? ` (+${values.length - shown.length} more)` : '';
  return `${shown.join(', ')}${suffix}`;
}

function buildSystemPrompt(): string {
  return [
    'You are rewriting a deterministic graph-backed answer for clarity for a recruiter demo.',
    'Do not invent facts, events, scenes, dates, or relationships.',
    'Do not contradict the structured answer provided by the system.',
    'Keep uncertainty and inferred-vs-explicit distinctions if present.',
    'Do not remove or alter references to evidence support; evidence refs are preserved downstream in the payload.',
    'Return only rewritten answer text (no markdown code fences, no JSON).',
  ].join(' ');
}

function buildUserPrompt(question: string, answer: StructuredAnswerCore): string {
  return [
    `Question: ${question}`,
    `Mode: ${answer.modeUsed}`,
    `Query type: ${answer.queryType}`,
    `Confidence: ${answer.confidence.toFixed(2)}`,
    `Structured counts: entities=${answer.entitiesUsed.length}, events=${answer.eventsUsed.length}, state_changes=${answer.stateChangesUsed.length}, evidence_refs=${answer.evidenceRefs.length}`,
    `Entity IDs (sample): ${compactList(answer.entitiesUsed, 8)}`,
    `Event IDs (sample): ${compactList(answer.eventsUsed, 10)}`,
    `State change IDs (sample): ${compactList(answer.stateChangesUsed, 8)}`,
    `Evidence refs (sample): ${compactList(answer.evidenceRefs, 10)}`,
    `Reasoning notes: ${truncate(answer.reasoningNotes, 900)}`,
    'Structured answer to rewrite:',
    truncate(answer.answerText, 4000),
    '',
    'Rewrite for readability while preserving the same core content and caveats. Avoid adding claims not present above.',
  ].join('\n');
}

function ensureAssistedLabel(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'LLM-assisted synthesis is unavailable; using deterministic answer.';
  if (/^LLM-assisted/i.test(trimmed)) return trimmed;
  return `LLM-assisted (structured evidence preserved)\n${trimmed}`;
}

function appendNote(base: string, addendum: string): string {
  const trimmedBase = base.trim();
  if (!trimmedBase) return addendum.trim();
  if (trimmedBase.includes(addendum)) return trimmedBase;
  return `${trimmedBase} ${addendum}`.trim();
}

export type LlmSynthesisOutcome = {
  answer: StructuredAnswerCore;
  assisted: boolean;
  skippedReason?: string;
  error?: string;
};

export async function maybeSynthesizeStructuredAnswerWithLLM(
  answer: StructuredAnswerCore,
  options: { question: string; label?: string },
): Promise<LlmSynthesisOutcome> {
  const normalized = normalizeStructuredAnswer(answer);
  const llmStatus = getLlmSynthesisStatus();

  if (!normalized.answerText.trim()) {
    return { answer: normalized, assisted: false, skippedReason: 'empty structured answer text' };
  }

  if (!llmStatus.enabled) {
    return { answer: normalized, assisted: false, skippedReason: llmStatus.reason };
  }

  const result = await generateOpenAIText({
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildUserPrompt(options.question, normalized),
    purpose: 'answer_synthesis',
  });

  if (!result.ok) {
    return {
      assisted: false,
      error: result.error,
      answer: {
        ...normalized,
        reasoningNotes: appendNote(
          normalized.reasoningNotes,
          `LLM synthesis attempted but fell back to deterministic answer (${result.model}: ${truncate(result.error, 220)}).`,
        ),
      },
    };
  }

  const labeledAnswerText = ensureAssistedLabel(truncate(result.text, 8000));
  const noteParts = [
    'LLM-assisted synthesis applied on top of deterministic structured retrieval/traversal.',
    'Structured IDs and evidence refs were preserved from the upstream answer.',
    `OpenAI model: ${result.model}.`,
  ];
  if (options.label) noteParts.push(`Context: ${options.label}.`);
  if (result.responseId) noteParts.push(`response_id=${result.responseId}.`);

  return {
    assisted: true,
    answer: {
      ...normalized,
      answerText: labeledAnswerText,
      reasoningNotes: appendNote(normalized.reasoningNotes, noteParts.join(' ')),
    },
  };
}
