import { NextRequest, NextResponse } from 'next/server';

import { answerBaselineOnly } from '@/lib/queryService';
import { normalizeQueryRequest, toApiQueryResponse, validateApiQueryResponse } from '@/lib/queryContract';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = (await request.json()) as unknown;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = normalizeQueryRequest(payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const response = await answerBaselineOnly(parsed.value.question, parsed.value.includeEvidence);
    const apiPayload = toApiQueryResponse(response);
    const validation = validateApiQueryResponse(apiPayload);
    if (!validation.ok) {
      return NextResponse.json(
        { error: `Internal response contract validation failed: ${validation.error}` },
        { status: 500 },
      );
    }
    return NextResponse.json(apiPayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Baseline query processing failed: ${message}` }, { status: 500 });
  }
}
