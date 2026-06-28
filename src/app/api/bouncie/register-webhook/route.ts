// src/app/api/bouncie/register-webhook/route.ts
// Registers our webhook URL with Bouncie to receive tripData events
// Run once: /api/bouncie/register-webhook?token=critterstop2026

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BOUNCIE_API = 'https://api.bouncie.dev/v1';
const WEBHOOK_URL = 'https://hub.critterstop.com/api/bouncie/webhook';

async function getBetaToken(): Promise<string> {
  const tokenSetting = await prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } });
  if (!tokenSetting?.value) throw new Error('Bouncie access token not found — reauth first');
  return tokenSetting.value;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const token = await getBetaToken();

    // List existing webhooks first
    const listRes = await fetch(`${BOUNCIE_API}/webhooks`, {
      headers: { Authorization: token, 'Content-Type': 'application/json' },
    });
    const existing = listRes.ok ? await listRes.json() : [];

    // Check if already registered
    const alreadyRegistered = Array.isArray(existing) && existing.find(
      (w: any) => w.url === WEBHOOK_URL || (w.url || '').includes('/api/bouncie/webhook')
    );

    if (alreadyRegistered) {
      return NextResponse.json({
        status: 'already_registered',
        webhook: alreadyRegistered,
        existing,
      });
    }

    // Register webhook for tripData events
    const registerRes = await fetch(`${BOUNCIE_API}/webhooks`, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: WEBHOOK_URL,
        eventTypes: ['tripData'],
      }),
    });

    const result = await registerRes.json();

    if (!registerRes.ok) {
      return NextResponse.json({ error: 'Registration failed', details: result, status: registerRes.status }, { status: 500 });
    }

    return NextResponse.json({ status: 'registered', webhook: result, existing });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
