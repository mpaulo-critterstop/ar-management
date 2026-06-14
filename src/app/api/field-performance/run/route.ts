import { NextRequest, NextResponse } from 'next/server';
import { POST } from '@/app/api/cron/field-performance/route';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const weekEnd = searchParams.get('weekEnd') || '';
  const body = weekEnd ? JSON.stringify({ weekEnd }) : '{}';
  const fakeReq = new NextRequest('https://hub.critterstop.com/api/cron/field-performance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body,
  });
  return POST(fakeReq);
}
