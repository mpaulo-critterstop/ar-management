// src/app/api/dialpad/sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function getConfig(key: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT value FROM dialpad_config WHERE key = ${key} LIMIT 1
  `;
  return rows[0]?.value || null;
}

async function setConfig(key: string, value: string) {
  await prisma.$executeRaw`
    INSERT INTO dialpad_config (key, value, updated_at)
    VALUES (${key}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role;
  if (!['ADMIN', 'MANAGER'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const resetCursor = body.reset === true;

  const apiKey = await getConfig('dialpad_api_key');
  if (!apiKey) return NextResponse.json({ error: 'Dialpad API key not configured' }, { status: 400 });

  let cursor = resetCursor ? null : await getConfig('last_sync_cursor');
  let processed = 0;
  let pages = 0;
  const MAX_PAGES = body.maxPages || 5;

  try {
    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.set('cursor', cursor);

      const resp = await fetch(`https://dialpad.com/api/v2/call?${params}`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`Dialpad API error: ${resp.status} — ${errBody.substring(0, 300)}`);
      }

      const data = await resp.json();
      const items = data.items || [];
      pages++;

      for (const call of items) {
        const phone = call.external_number || call.contact?.phone || '';
        const state = call.date_connected ? 'answered' : 'missed';
        const callId = String(call.call_id || call.id || '');
        if (!callId) continue;

        // Track known callers
        if (phone) {
          const existing = await prisma.$queryRaw<Array<{ phone_number: string }>>`
            SELECT phone_number FROM dialpad_known_callers WHERE phone_number = ${phone} LIMIT 1
          `;
          if (!existing[0]) {
            await prisma.$executeRaw`
              INSERT INTO dialpad_known_callers (phone_number, first_seen, call_count, updated_at)
              VALUES (${phone}, ${Number(call.date_started)}, 1, NOW())
              ON CONFLICT (phone_number) DO UPDATE SET call_count = dialpad_known_callers.call_count + 1, updated_at = NOW()
            `;
          } else {
            await prisma.$executeRaw`
              UPDATE dialpad_known_callers SET call_count = call_count + 1, updated_at = NOW()
              WHERE phone_number = ${phone}
            `;
          }
        }

        // Check first-time
        const prevCalls = await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM dialpad_calls WHERE external_number = ${phone} AND direction = 'inbound' LIMIT 1
        `;
        const isFirstTime = phone ? prevCalls.length === 0 : false;

        await prisma.$executeRaw`
          INSERT INTO dialpad_calls (
            id, date_started, date_connected, date_ended, direction, duration, state,
            external_number, internal_number, tracking_number, target_name, target_id,
            target_type, contact_name, entry_point_name, entry_point_call_id,
            operator_call_id, master_call_id, categories, is_first_time
          ) VALUES (
            ${callId},
            ${Number(call.date_started || 0)},
            ${call.date_connected ? Number(call.date_connected) : null},
            ${call.date_ended ? Number(call.date_ended) : null},
            ${call.direction || 'inbound'},
            ${call.duration ? Math.round(Number(call.duration) / 1000) : 0},
            ${state},
            ${phone},
            ${call.internal_number || ''},
            ${call.internal_number || ''},
            ${call.target?.name || call.entry_point_target?.name || ''},
            ${String(call.target?.id || '')},
            ${call.target?.type || ''},
            ${call.contact?.name || ''},
            ${call.entry_point_target?.name || ''},
            ${String(call.entry_point_call_id || '')},
            ${String(call.operator_call_id || '')},
            ${String(call.master_call_id || '')},
            ${call.categories || ''},
            ${isFirstTime}
          )
          ON CONFLICT (id) DO UPDATE SET
            date_connected = EXCLUDED.date_connected,
            date_ended = EXCLUDED.date_ended,
            duration = EXCLUDED.duration,
            state = EXCLUDED.state
        `;
        processed++;
      }

      cursor = data.cursor || null;
      if (items.length === 0) break;

    } while (cursor && pages < MAX_PAGES);

    if (cursor) await setConfig('last_sync_cursor', cursor);
    else await prisma.$executeRaw`DELETE FROM dialpad_config WHERE key = 'last_sync_cursor'`;

    return NextResponse.json({
      status: 'success',
      processed,
      pages,
      hasMore: !!cursor,
      cursor,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, processed }, { status: 500 });
  }
}
