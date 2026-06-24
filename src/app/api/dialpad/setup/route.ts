import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DIALPAD_API = 'https://dialpad.com/api/v2';
const HUB_URL = 'https://hub.critterstop.com';

async function getConfig(key: string): Promise<string | null> {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT value FROM dialpad_config WHERE key = ${key} LIMIT 1
  `;
  return row[0]?.value || null;
}

async function dialpadFetch(path: string, method = 'GET', body?: any) {
  const apiKey = await getConfig('dialpad_api_key');
  if (!apiKey) throw new Error('dialpad_api_key not configured');
  const separator = path.includes('?') ? '&' : '?';
  const url = `${DIALPAD_API}${path}${separator}apikey=${apiKey}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error(text.substring(0, 200)); }
}

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [webhooks, subscriptions] = await Promise.all([
      dialpadFetch('/webhooks'),
      dialpadFetch('/subscriptions/call'),
    ]);
    return NextResponse.json({ webhooks, subscriptions });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (new URL(req.url).searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { action, webhook_id, subscription_id } = await req.json();

    if (action === 'create_webhook') {
      return NextResponse.json(await dialpadFetch('/webhooks', 'POST', {
        hook_url: `${HUB_URL}/api/dialpad/webhook`,
      }));
    }
    if (action === 'create_subscription') {
      return NextResponse.json(await dialpadFetch('/subscriptions/call', 'POST', {
        webhook_id,
        call_states: ['hangup', 'missed', 'voicemail'],
      }));
    }
    if (action === 'create_recap_subscription') {
      // Recap uses a different endpoint/format than call state subscriptions
      return NextResponse.json(await dialpadFetch('/subscriptions/call', 'POST', {
        webhook_id,
        call_states: ['hangup'],
        enabled: true,
      }));
    }
    if (action === 'delete_subscription') {
      return NextResponse.json(await dialpadFetch(`/subscriptions/call/${subscription_id}`, 'DELETE'));
    }
    if (action === 'delete_webhook') {
      return NextResponse.json(await dialpadFetch(`/webhooks/${webhook_id}`, 'DELETE'));
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
