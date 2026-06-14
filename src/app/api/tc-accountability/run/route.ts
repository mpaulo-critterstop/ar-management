import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekEnd = searchParams.get('weekEnd') || '';
  const res = await fetch(`${process.env.NEXTAUTH_URL}/api/cron/tc-accountability`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify(weekEnd ? { weekEnd } : {}),
  });
  return NextResponse.json(await res.json());
}
