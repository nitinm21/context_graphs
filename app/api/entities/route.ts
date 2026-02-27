import { NextRequest, NextResponse } from 'next/server';

import { listEntities } from '@/lib/kgData';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') ?? undefined;
  const typeParam = searchParams.get('type') ?? undefined;
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

  const result = await listEntities({
    q,
    type:
      typeParam && ['character', 'location', 'organization', 'group', 'object', 'all'].includes(typeParam)
        ? (typeParam as 'character' | 'location' | 'organization' | 'group' | 'object' | 'all')
        : 'all',
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return NextResponse.json(result);
}
