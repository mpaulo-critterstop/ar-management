// src/app/api/cron/sync/route.ts

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Verify this is called by our cron service
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check if current hour is within 7am-10pm
  const hour = new Date().getHours();
  if (hour < 7 || hour >= 22) {
    return NextResponse.json({ message: 'Outside sync hours' });
  }

  // Trigger sync for all offices
  const baseUrl = process.env.NEXTAUTH_URL;
  // Fire and forget — don't wait for sync to complete
  fetch(`${baseUrl}/api/sync/auto`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'x-cron-secret': process.env.CRON_SECRET || '',
    },
    body: JSON.stringify({}),
  }).catch(err => console.error('Sync trigger error:', err));

  return NextResponse.json({ message: 'Sync triggered successfully' });
