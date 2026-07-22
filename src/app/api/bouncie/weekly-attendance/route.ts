import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const CLIENT_ID = 'critter-stop-';
const CLIENT_SECRET = process.env.BOUNCIE_CLIENT_SECRET!;
const BASE_URL = 'https://api.bouncie.dev/v1';

async function getToken(): Promise<string> {
  const [t, e, r] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_token_expires_at' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_refresh_token' } }),
  ]);
  if (!t || !r) throw new Error('Not connected');
  const exp = e ? new Date(e.value) : new Date(0);
  if (exp.getTime() - Date.now() > 5 * 60 * 1000) return t.value;
  const res = await fetch('https://auth.bouncie.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: r.value }),
  });
  const tokens = await res.json();
  await Promise.all([
    prisma.appSetting.update({ where: { key: 'bouncie_access_token' }, data: { value: tokens.access_token } }),
    prisma.appSetting.update({ where: { key: 'bouncie_refresh_token' }, data: { value: tokens.refresh_token } }),
    prisma.appSetting.update({ where: { key: 'bouncie_token_expires_at' }, data: { value: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString() } }),
  ]);
  return tokens.access_token;
}

function fmtTime(dt: string) {
  return new Date(dt).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Chicago'
  });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !['Admin', 'Manager'].includes((session.user as any)?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const weekEndParam = searchParams.get('weekEnd') || '2026-06-05';

  const weekStart = new Date(weekEndParam.split('-').length === 3
    ? new Date(weekEndParam + 'T06:00:00.000Z').getTime() - 6 * 24 * 60 * 60 * 1000
    : Date.now());
  const weekEnd = new Date(weekEndParam + 'T06:00:00.000Z');
  // Add 7 days for the window
  const weekEndPlus = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const token = await getToken();

  // Get all vehicles
  const vRes = await fetch(`${BASE_URL}/vehicles`, {
    headers: { 'Authorization': token },
  });
  const vehicles = await vRes.json();

  const results: any[] = [];

  for (const vehicle of vehicles) {
    try {
      const url = new URL(`${BASE_URL}/trips`);
      url.searchParams.set('imei', vehicle.imei);
      url.searchParams.set('gps-format', 'polyline');
      url.searchParams.set('starts-after', weekStart.toISOString());
      url.searchParams.set('ends-before', weekEndPlus.toISOString());

      const res = await fetch(url.toString(), { headers: { 'Authorization': token } });
      if (!res.ok) continue;
      const trips = await res.json();
      if (!Array.isArray(trips) || trips.length === 0) continue;

      // Get first trip start per day
      const byDay: Record<string, string> = {};
      for (const trip of trips) {
        const dateKey = new Date(trip.startTime).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
        if (!byDay[dateKey] || new Date(trip.startTime) < new Date(byDay[dateKey])) {
          byDay[dateKey] = trip.startTime;
        }
      }

      const dailyStarts = Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, startTime]) => ({
          date,
          startTime: fmtTime(startTime),
        }));

      results.push({
        imei: vehicle.imei,
        nickName: vehicle.nickName,
        trips: trips.length,
        dailyStarts,
      });

      await new Promise(r => setTimeout(r, 150));
    } catch { continue; }
  }

  return NextResponse.json({ weekStart: weekStart.toISOString(), weekEnd: weekEnd.toISOString(), vehicles: results });
}
