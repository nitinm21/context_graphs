import { NextRequest, NextResponse } from 'next/server';

import { getEntityNeighbors } from '@/lib/kgData';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const entityId = searchParams.get('entityId');
  if (!entityId) {
    return NextResponse.json({ error: 'Missing entityId query parameter' }, { status: 400 });
  }

  const result = await getEntityNeighbors(entityId);
  if (result.available && !result.entity) {
    return NextResponse.json({ error: `Unknown entityId: ${entityId}` }, { status: 404 });
  }

  return NextResponse.json(result);
}
