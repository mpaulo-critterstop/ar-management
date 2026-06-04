// src/app/api/cron/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const office = searchParams.get('office') || '';
  const baseUrl = process.env.NEXTAUTH_URL;

  try {
    // Step 1 — AR sync first (must complete before leads sync)
    console.log(`[cron] Starting AR sync for ${office || 'all offices'}...`);
    await fetch(`${baseUrl}/api/sync/auto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET || '',
      },
      body: JSON.stringify({ office }),
      // @ts-ignore
      signal: AbortSignal.timeout(600000),
    });
    console.log(`[cron] AR sync complete. Starting leads sync...`);

    // Step 2 — Leads sync after AR is done
    await fetch(`${baseUrl}/api/sync/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET || '',
      },
      body: JSON.stringify({ office }),
      // @ts-ignore
      signal: AbortSignal.timeout(600000),
    });
    console.log(`[cron] Leads sync complete.`);

  } catch (err) {
    console.error(`[cron] Sync error:`, err);
  }

  return NextResponse.json({ message: `Sync complete for ${office || 'all offices'}` });
}
