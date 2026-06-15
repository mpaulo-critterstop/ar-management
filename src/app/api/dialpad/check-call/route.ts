import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const callId = searchParams.get('id');
  if (!callId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const row = await prisma.$queryRaw<Array<{value: string}>>`
    SELECT value FROM dialpad_config WHERE key = 'dialpad_api_key' LIMIT 1
  `;
  const apiKey = row[0]?.value;
  if (!apiKey) return NextResponse.json({ error: 'no api key' }, { status: 500 });

  const res = await fetch(`https://dialpad.com/api/v2/call/${callId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
  });
  const data = await res.json();
  return NextResponse.json({ 
    call_id: data.call_id || data.id,
    state: data.state,
    categories: data.categories,
    target: data.target,
    date_connected: data.date_connected,
    all_keys: Object.keys(data),
  });
}
