// src/app/api/cron/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const hour = new Date().getHours();
  if (hour < 7 || hour >= 22) {
    return NextResponse.json({ message: 'Outside sync hours' });
  }

  const { searchParams } = new URL(req.url);
  const office = searchParams.get('office') || '';

  const baseUrl = process.env.NEXTAUTH_URL;
  fetch(`${baseUrl}/api/sync/auto`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': process.env.CRON_SECRET || '',
    },
    body: JSON.stringify({ office }),
    // @ts-ignore
    signal: AbortSignal.timeout(600000), // 10 minute timeout
  }).catch(err => console.error(`Sync trigger error for ${office}:`, err));

  return NextResponse.json({ message: `Sync triggered for ${office || 'all offices'}` });
}
