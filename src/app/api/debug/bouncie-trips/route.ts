import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BOUNCIE_API = 'https://api.bouncie.dev/v1';

async function bouncieFetch(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${BOUNCIE_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Bouncie ${path} failed: ${res.status}`);
  return res.json();
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const BUSINESS_LOCATIONS = [
  { name: 'Southlake HQ', lat: 32.9244, lng: -97.1252 },
  { name: 'Control Source', lat: 33.0417197, lng: -96.9918763 },
  { name: 'Richardson', lat: 32.9581813, lng: -96.7170318 },
];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (token !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const techId = searchParams.get('techId') || 'P-013';
  const date = searchParams.get('date') || '2026-06-12';

  // Get Bouncie token from AppSetting (same as reliability cron)
  const [tokenSetting, expiresSetting, refreshSetting] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_token_expires_at' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_refresh_token' } }),
  ]);

  if (!tokenSetting || !refreshSetting) return NextResponse.json({ error: 'Bouncie not connected' });

  let bouncieToken = tokenSetting.value;
  const expiresAt = new Date(expiresSetting?.value || 0);
  if (expiresAt.getTime() - Date.now() <= 5 * 60 * 1000) {
    const res = await fetch('https://auth.bouncie.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.BOUNCIE_CLIENT_ID,
        client_secret: process.env.BOUNCIE_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshSetting.value,
      }),
    });
    const tokens = await res.json();
    bouncieToken = tokens.access_token;
  }

  // Get vehicles
  const vehicles = await bouncieFetch('/vehicles', bouncieToken);

  // Find tech
  const tech = await prisma.technician.findFirst({ 
    where: { techId }, 
    select: { id: true, name: true, techId: true, bouncieDevice: { select: { bouncieName: true, deviceId: true } } } 
  });
  if (!tech) return NextResponse.json({ error: 'Tech not found' });

  // Find vehicle by deviceId or name match
  const techDeviceId = tech.bouncieDevice?.deviceId;
  const techBouncieName = tech.bouncieDevice?.bouncieName?.toLowerCase();
  const vehicle = vehicles.find((v: any) =>
    (techDeviceId && v.imei === techDeviceId) ||
    (techBouncieName && (v.nickName || '').toLowerCase().includes(techBouncieName)) ||
    (v.nickName || '').toLowerCase().includes(tech.name.split(' ')[0].toLowerCase()) ||
    (v.nickName || '').toLowerCase().includes(tech.name.split(' ').pop()!.toLowerCase())
  );

  if (!vehicle) return NextResponse.json({ error: 'Vehicle not found', techName: tech.name, techBouncieName, techDeviceId, vehicles: vehicles.map((v: any) => ({ nickName: v.nickName, imei: v.imei })) });

  // Get route customer cache
  const cacheKey = `rc_customers_DFW_${date}`;
  const cached = await prisma.appSetting.findUnique({ where: { key: cacheKey } });
  const routeMap = cached?.value ? JSON.parse(cached.value) : {};
  const routeCoords: Array<{ lat: number; lng: number; customerId?: string; frAppointmentId?: string }> = routeMap[techId] || [];

  // Fetch trips for the day
  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.000Z`);
  const trips = await bouncieFetch('/trips', bouncieToken, {
    imei: vehicle.imei,
    'gps-format': 'geojson',
    'starts-after': dayStart.toISOString(),
    'ends-before': dayEnd.toISOString(),
  });

  const timeZone = 'America/Chicago';

  // Analyze each trip
  const analyzedTrips = (Array.isArray(trips) ? trips : []).sort((a: any, b: any) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  ).map((trip: any, i: number) => {
    const coords = trip.gps?.coordinates || [];
    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];

    const startLat = startCoord?.[1];
    const startLng = startCoord?.[0];
    const endLat = endCoord?.[1];
    const endLng = endCoord?.[0];

    const startTime = new Date(trip.startTime).toLocaleTimeString('en-US', { timeZone, hour12: true });
    const endTime = new Date(trip.endTime).toLocaleTimeString('en-US', { timeZone, hour12: true });

    // Check start location
    let startMatch = 'unknown';
    if (startLat && startLng) {
      for (const biz of BUSINESS_LOCATIONS) {
        if (haversineDistance(startLat, startLng, biz.lat, biz.lng) <= 300) {
          startMatch = biz.name;
          break;
        }
      }
      if (startMatch === 'unknown') {
        const custMatch = routeCoords.find(c => haversineDistance(startLat, startLng, c.lat, c.lng) <= 500);
        if (custMatch) startMatch = `customer (${custMatch.customerId})`;
      }
    }

    // Check end location
    let endMatch = 'unknown';
    if (endLat && endLng) {
      for (const biz of BUSINESS_LOCATIONS) {
        if (haversineDistance(endLat, endLng, biz.lat, biz.lng) <= 300) {
          endMatch = biz.name;
          break;
        }
      }
      if (endMatch === 'unknown') {
        const custMatch = routeCoords.find(c => haversineDistance(endLat, endLng, c.lat, c.lng) <= 500);
        if (custMatch) endMatch = `customer (${custMatch.customerId})`;
      }
    }

    return {
      tripIndex: i + 1,
      startTime,
      endTime,
      startLat, startLng,
      endLat, endLng,
      distance: parseFloat(trip.distance || '0').toFixed(1) + ' mi',
      startMatch,
      endMatch,
      setsEndOfDay: startMatch !== 'unknown',
    };
  });

  return NextResponse.json({
    techId,
    techName: tech.name,
    vehicle: vehicle.nickName,
    date,
    routeCustomers: routeCoords.length,
    trips: analyzedTrips,
    endOfDayWouldBe: analyzedTrips.filter(t => t.setsEndOfDay).pop()?.startTime || 'none',
  });
}
