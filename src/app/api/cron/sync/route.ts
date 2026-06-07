// src/app/api/cron/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';

  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    signal: AbortSignal.timeout(600000),
  }).catch(err => console.error(`Sync trigger error for ${office}:`, err));

  fetch(`${baseUrl}/api/sync/appointments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-cron-secret': process.env.CRON_SECRET || '',
    },
    body: JSON.stringify({ office }),
    // @ts-ignore
    signal: AbortSignal.timeout(600000),
  }).catch(err => console.error(`Appointment sync trigger error for ${office}:`, err));

  return NextResponse.json({ message: `Sync triggered for ${office || 'all offices'}` });
}
