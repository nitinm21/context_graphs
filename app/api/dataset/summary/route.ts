import { NextResponse } from 'next/server';

import { getDatasetSummary } from '@/lib/datasetSummary';

export const runtime = 'nodejs';

export async function GET() {
  const summary = await getDatasetSummary();
  return NextResponse.json(summary);
}
