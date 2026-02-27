import { NextRequest, NextResponse } from 'next/server';

import { getTimelineSlice } from '@/lib/ntgData';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get('year');
  const limitScenesParam = searchParams.get('limitScenes');
  const includeBlocksParam = searchParams.get('includeBlocks');

  const yearParsed = yearParam ? Number.parseInt(yearParam, 10) : undefined;
  const limitScenesParsed = limitScenesParam ? Number.parseInt(limitScenesParam, 10) : undefined;

  const result = await getTimelineSlice({
    year: Number.isFinite(yearParsed) ? yearParsed : undefined,
    entityId: searchParams.get('entityId') ?? undefined,
    eventType: searchParams.get('eventType') ?? undefined,
    pair: searchParams.get('pair') ?? undefined,
    q: searchParams.get('q') ?? undefined,
    limitScenes: Number.isFinite(limitScenesParsed) ? limitScenesParsed : undefined,
    includeBlocks: includeBlocksParam === '1' || includeBlocksParam === 'true',
  });

  return NextResponse.json(result);
}
