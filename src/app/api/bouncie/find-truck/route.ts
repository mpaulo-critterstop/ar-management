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

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !['ADMIN', 'MANAGER'].includes((session.user as any)?.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Target start times from spreadsheet (CST)
  const targets = [
    { date: '06/01/2026', time: '06:34', label: '6/1 6:34 AM' },
    { date: '06/02/2026', time: '08:33', label: '6/2 8:33 AM' },
    { date: '06/03/2026', time: '06:49', label: '6/3 6:49 AM' },
    { date: '06/04/2026', time: '08:17', label: '6/4 8:17 AM' },
  ];

  // Unmapped/vacant vehicle IMEIs to check
  const suspects = [
    '864486066802733',
    '864486067072179',
    '864486067718276',
    '865612071108928',
    '866392061868679',
    '866392065178182',
    '866392065853479',
  ];

  const token = await getToken();
  const results: any[] = [];

  // Week range
  const weekStart = new Date('2026-05-30T06:00:00.000Z'); // Sat midnight CST
  const weekEnd = new Date('2026-06-06T06:00:00.000Z');   // Next Sat midnight CST

  for (const imei of suspects) {
    try {
      const url = new URL(`${BASE_URL}/trips`);
      url.searchParams.set('imei', imei);
      url.searchParams.set('gps-format', 'polyline');
      url.searchParams.set('starts-after', weekStart.toISOString());
      url.searchParams.set('ends-before', weekEnd.toISOString());

      const res = await fetch(url.toString(), {
        headers: { 'Authorization': token },
      });
      if (!res.ok) continue;
      const trips = await res.json();
      if (!Array.isArray(trips) || trips.length === 0) continue;

      // Get first trip of each day and check start time
      const byDay: Record<string, any> = {};
      for (const trip of trips) {
        const start = new Date(trip.startTime);
        const dateKey = start.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'America/Chicago' });
        if (!byDay[dateKey] || new Date(trip.startTime) < new Date(byDay[dateKey].startTime)) {
          byDay[dateKey] = trip;
        }
      }

      // Check matches
      const matches: string[] = [];
      for (const target of targets) {
        const dayTrip = byDay[target.date];
        if (!dayTrip) continue;
        const tripStart = new Date(dayTrip.startTime);
        const cstTime = tripStart.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago' });
        const [th, tm] = cstTime.split(':').map(Number);
        const [tth, ttm] = target.time.split(':').map(Number);
        const diffMins = Math.abs((th * 60 + tm) - (tth * 60 + ttm));
        if (diffMins <= 5) matches.push(`${target.label} (actual: ${cstTime})`);
      }

      if (matches.length > 0) {
        results.push({ imei, matches, totalTrips: trips.length });
      }

      await new Promise(r => setTimeout(r, 200));
    } catch { continue; }
  }

  return NextResponse.json({ results, checked: suspects.length });
}
