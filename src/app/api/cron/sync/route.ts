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
  const res = await fetch(`${baseUrl}/api/sync/auto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  const data = await res.json();
  return NextResponse.json(data);
}
