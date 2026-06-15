import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const DIALPAD_API = 'https://dialpad.com/api/v2';
const HUB_URL = 'https://hub.critterstop.com';

async function getApiKey() {
  const row = await prisma.$queryRaw<Array<{value: string}>>`
    SELECT value FROM dialpad_config WHERE key = 'dialpad_api_key' LIMIT 1
  `;
  return row[0]?.value || '';
}

async function dialpadFetch(path: string, method = 'GET', body?: any) {
  const key = await getApiKey();
  const res = await fetch(`${DIALPAD_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

export async function GET(req: NextRequest) {
  if (new URL(req.url).searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const [webhooks, subscriptions] = await Promise.all([
    dialpadFetch('/webhooks'),
    dialpadFetch('/subscriptions'),
  ]);
  return NextResponse.json({ webhooks, subscriptions });
}

export async function POST(req: NextRequest) {
  if (new URL(req.url).searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { action, webhook_id, subscription_id } = await req.json();

  if (action === 'create_webhook') {
    return NextResponse.json(await dialpadFetch('/webhooks', 'POST', {
      hook_url: `${HUB_URL}/api/dialpad/webhook`,
    }));
  }
  if (action === 'create_subscription') {
    return NextResponse.json(await dialpadFetch('/subscriptions', 'POST', {
      webhook_id,
      call_states: ['hangup', 'missed', 'voicemail'],
    }));
  }
  if (action === 'create_recap_subscription') {
    return NextResponse.json(await dialpadFetch('/subscriptions', 'POST', {
      webhook_id,
      event_type: 'recap',
    }));
  }
  if (action === 'delete_subscription') {
    return NextResponse.json(await dialpadFetch(`/subscriptions/${subscription_id}`, 'DELETE'));
  }
  if (action === 'delete_webhook') {
    return NextResponse.json(await dialpadFetch(`/webhooks/${webhook_id}`, 'DELETE'));
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
