import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const CLIENT_ID     = 'critter-stop-';
const CLIENT_SECRET = process.env.BOUNCIE_CLIENT_SECRET!;

async function getAccessToken(): Promise<string> {
  const [tokenSetting, expiresSetting, refreshSetting] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_token_expires_at' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_refresh_token' } }),
  ]);

  if (!tokenSetting || !refreshSetting) throw new Error('Bouncie not connected');

  const expiresAt = expiresSetting ? new Date(expiresSetting.value) : new Date(0);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return tokenSetting.value;

  const res = await fetch('https://auth.bouncie.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token', refresh_token: refreshSetting.value,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const tokens = await res.json();
  const newExpiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
  await Promise.all([
    prisma.appSetting.update({ where: { key: 'bouncie_access_token' }, data: { value: tokens.access_token } }),
    prisma.appSetting.update({ where: { key: 'bouncie_refresh_token' }, data: { value: tokens.refresh_token } }),
    prisma.appSetting.update({ where: { key: 'bouncie_token_expires_at' }, data: { value: newExpiresAt.toISOString() } }),
  ]);
  return tokens.access_token;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = (session.user as any)?.role;
  if (!['ADMIN', 'MANAGER'].includes(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const token = await getAccessToken();
    const res = await fetch('https://api.bouncie.dev/v1/vehicles', {
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`Bouncie API error: ${res.status}`);
    const vehicles = await res.json();

    // Also get existing mappings
    const mappings = await prisma.bouncieDevice.findMany({
      include: { technician: { select: { techId: true, name: true } } },
    });
    const mappedImeis = new Set(mappings.map(m => m.deviceId));

    const result = vehicles.map((v: any) => ({
      imei:      v.imei,
      nickName:  v.nickName,
      vin:       v.vin,
      model:     v.model,
      mapped:    mappedImeis.has(v.imei),
      techId:    mappings.find(m => m.deviceId === v.imei)?.technician?.techId ?? null,
      techName:  mappings.find(m => m.deviceId === v.imei)?.technician?.name ?? null,
    }));

    return NextResponse.json({ count: result.length, vehicles: result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
