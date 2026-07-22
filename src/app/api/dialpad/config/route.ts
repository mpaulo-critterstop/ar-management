// src/app/api/dialpad/config/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'dialpad')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any)?.role;
  if (!['ADMIN', 'MANAGER'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = await prisma.$queryRaw<Array<{ key: string; value: string }>>`
    SELECT key, value FROM dialpad_config WHERE key NOT IN ('last_webhook', 'last_sync_cursor')
  `;

  // Mask sensitive keys
  const config: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === 'dialpad_api_key' || row.key === 'anthropic_api_key') {
      config[row.key] = row.value ? '••••••••••••' + row.value.slice(-4) : '';
    } else {
      config[row.key] = row.value;
    }
  }

  // Check total calls
  const countRows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) as count FROM dialpad_calls`;
  const totalCalls = Number(countRows[0]?.count || 0);

  return NextResponse.json({ config, totalCalls });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'dialpad')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any)?.role;
  if (!['ADMIN'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { key, value } = body;

  if (!key || value === undefined) return NextResponse.json({ error: 'key and value required' }, { status: 400 });

  // Validate Dialpad API key if that's what's being set
  if (key === 'dialpad_api_key') {
    const testResp = await fetch('https://dialpad.com/api/v2/call?limit=1', {
      headers: { 'Authorization': `Bearer ${value}`, 'Accept': 'application/json' },
    }).catch(() => null);
    if (!testResp?.ok) return NextResponse.json({ error: 'Invalid Dialpad API key' }, { status: 400 });
  }

  await prisma.$executeRaw`
    INSERT INTO dialpad_config (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;

  return NextResponse.json({ success: true });
}
