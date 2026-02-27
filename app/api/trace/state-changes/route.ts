import { NextRequest, NextResponse } from 'next/server';

import { listStateChanges } from '@/lib/ntgData';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const limitParsed = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const claimType = searchParams.get('claimType');

  const result = await listStateChanges({
    subjectId: searchParams.get('subjectId') ?? undefined,
    objectId: searchParams.get('objectId') ?? undefined,
    entityId: searchParams.get('entityId') ?? undefined,
    pair: searchParams.get('pair') ?? undefined,
    stateDimension: searchParams.get('stateDimension') ?? undefined,
    claimType: claimType === 'explicit' || claimType === 'inferred' ? claimType : undefined,
    sceneId: searchParams.get('sceneId') ?? undefined,
    limit: Number.isFinite(limitParsed) ? limitParsed : undefined,
  });

  return NextResponse.json(result);
}
