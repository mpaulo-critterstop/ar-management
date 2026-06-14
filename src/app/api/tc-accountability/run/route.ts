import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekEnd = searchParams.get('weekEnd') || '';
  // Call via absolute URL to avoid internal caching issues
  const baseUrl = req.headers.get('x-forwarded-host')
    ? `https://${req.headers.get('x-forwarded-host')}`
    : process.env.NEXTAUTH_URL || 'https://hub.critterstop.com';

  const res = await fetch(`${baseUrl}/api/cron/tc-accountability`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify(weekEnd ? { weekEnd } : {}),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json());
}
