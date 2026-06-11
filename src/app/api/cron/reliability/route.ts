// src/app/api/cron/reliability/route.ts
// Weekly sync: calculates reliability score (punctuality + utilization) per tech
// Uses Bouncie trip GPS to determine:
//   - Start of day: first trip END at a business location (customer, office, supplier)
//   - End of day: last trip START from a business location
//   - minutesLate = startOfDay - scheduledStartTime
//   - utilization = (endOfDay - startOfDay) / scheduledHours

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CLIENT_ID     = 'critter-stop-';
const CLIENT_SECRET = process.env.BOUNCIE_CLIENT_SECRET!;
const BASE_URL      = 'https://api.bouncie.dev/v1';

// ─── BUSINESS LOCATIONS ──────────────────────────────────────────────────────
// All offices and known suppliers — trips starting/ending here are "business"
const BUSINESS_LOCATIONS = [
  // DFW Offices
  { name: 'Southlake HQ',          lat: 32.9400,  lng: -97.1336 },
  { name: 'Haltom City',           lat: 32.8121,  lng: -97.2698 },
  { name: 'Oak Lawn Dallas',        lat: 32.8198,  lng: -96.8209 },
  { name: 'Richardson',             lat: 32.9483,  lng: -96.7077 },
  { name: 'The Colony',             lat: 33.0862,  lng: -96.8884 },
  { name: 'Justin',                 lat: 33.0748,  lng: -97.2951 },
  // ATX
  { name: 'Austin Office',          lat: 30.3868,  lng: -97.7218 },
  // OKC
  { name: 'OKC Office',             lat: 35.4442,  lng: -97.5198 },
  // CStat
  { name: 'College Station Office', lat: 30.5856,  lng: -96.3063 },
  // Suppliers
  { name: 'Control Source',         lat: 33.0376,  lng: -97.0641 },
  { name: 'Veseris Dallas',         lat: 32.8972,  lng: -96.7537 },
  { name: 'Veseris Grand Prairie',  lat: 32.7459,  lng: -97.0208 },
];

const GEOFENCE_RADIUS_M = 300; // 300 meter radius

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function isBusinessLocation(lat: number, lng: number): { match: boolean; name?: string } {
  for (const loc of BUSINESS_LOCATIONS) {
    const dist = haversineDistance(lat, lng, loc.lat, loc.lng);
    if (dist <= GEOFENCE_RADIUS_M) return { match: true, name: loc.name };
  }
  return { match: false };
}

function isCustomerLocation(
  lat: number, lng: number,
  customers: Array<{ lat: number; lng: number; name?: string }>
): boolean {
  for (const c of customers) {
    if (haversineDistance(lat, lng, c.lat, c.lng) <= GEOFENCE_RADIUS_M) return true;
  }
  return false;
}

function getScheduledStartMinutes(startTime: string): number {
  // Parse "7:00 AM" or "8:00 AM" → minutes since midnight
  const match = startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 7 * 60;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function getMinutesSinceMidnight(date: Date, timeZone: string): number {
  const local = new Date(date.toLocaleString('en-US', { timeZone }));
  return local.getHours() * 60 + local.getMinutes();
}

function fmtDate(d: Date) { return d.toISOString().split('T')[0]; }

// ─── TOKEN MANAGEMENT ────────────────────────────────────────────────────────
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

async function bouncieFetch(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': token, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bouncie ${path} failed: ${res.status} — ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Extract first and last GPS coordinates from geojson trip
function extractTripEndpoints(trip: any): { startLat: number; startLng: number; endLat: number; endLng: number } | null {
  try {
    const gps = trip.gps;
    if (!gps) return null;

    let coords: number[][] = [];

    if (typeof gps === 'string') {
      // GeoJSON string
      const parsed = JSON.parse(gps);
      coords = parsed.coordinates || [];
    } else if (gps.coordinates) {
      coords = gps.coordinates;
    } else if (Array.isArray(gps)) {
      coords = gps;
    }

    if (coords.length < 2) return null;

    const first = coords[0];
    const last = coords[coords.length - 1];

    return {
      startLat: first[1], startLng: first[0],
      endLat:   last[1],  endLng:   last[0],
    };
  } catch {
    return null;
  }
}

// ─── SCORING ─────────────────────────────────────────────────────────────────
// Reliability = MIN((105 - minutesLate×2)×0.5 + (utilization×100)×0.5, 110) / 100
function calcReliability(minutesLate: number, utilization: number): number {
  return Math.min(((105 - minutesLate * 2) * 0.5 + (utilization * 100) * 0.5), 110) / 100;
}

function calcWPScore(co: number, cb: number | null, drv: number, rel: number): number {
  const coTerm = Math.min(co + (1 - 0.85), 1.1) * 0.45;
  const cbTerm = cb !== null ? ((1 + 0.15*2) - cb*2) * 0.30 : Math.min(co + (1-0.85), 1.1) * 0.30;
  return coTerm + cbTerm + drv * 0.10 + rel * 0.15;
}

function calcPMPScore(revEff: number, resv: number, comp: number, drv: number, rel: number): number {
  return revEff*0.35 + (0.95+0.10-resv)*0.20 + (1-(0.95-comp)*5)*0.20 + drv*0.10 + rel*0.15;
}

function calcIPScore(drv: number, rel: number): number {
  return drv * 0.50 + rel * 0.50;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  const weekEnd = body.weekEnd
    ? new Date(body.weekEnd + 'T00:00:00.000Z')
    : (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const day = d.getDay();
      d.setDate(d.getDate() - (day >= 5 ? day - 5 : day + 2));
      return d;
    })();

  const weekStart = new Date(weekEnd);
  weekStart.setDate(weekStart.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const log: string[] = [`Reliability sync: ${fmtDate(weekStart)} → ${fmtDate(weekEnd)}`];
  const errors: string[] = [];
  let updated = 0;

  try {
    const token = await getAccessToken();
    log.push('Token obtained ✓');

    // Get all vehicles
    const vehicles = await bouncieFetch('/vehicles', token);

    // Load bouncie device → tech mappings
    const bouncieDevices = await prisma.bouncieDevice.findMany({
      include: { technician: true },
    });
    const imeiToTech = new Map(bouncieDevices.map(d => [d.deviceId!, d.technician]));
    const nameToTech = new Map(bouncieDevices.map(d => [d.bouncieName.toLowerCase(), d.technician]));

    // Load geocoded customer coordinates
    const customers = await prisma.customer.findMany({
      where: { lat: { not: null }, lng: { not: null } },
      select: { id: true, lat: true, lng: true },
    });
    const customerCoords = customers.map(c => ({ lat: c.lat!, lng: c.lng! }));

    log.push(`Business locations: ${BUSINESS_LOCATIONS.length}, Geocoded customers: ${customers.length}`);

    // Process each vehicle
    for (const vehicle of vehicles) {
      const imei: string = vehicle.imei;
      const nickName: string = (vehicle.nickName || '').toLowerCase();

      let tech = imeiToTech.get(imei);
      if (!tech) tech = nameToTech.get(nickName);
      if (!tech) continue;

      // Fetch trips for the week with geojson GPS
      let trips: any[] = [];
      try {
        const weekEndPlusOne = new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000);
        trips = await bouncieFetch('/trips', token, {
          imei,
          'gps-format':   'geojson',
          'starts-after': weekStart.toISOString(),
          'ends-before':  weekEndPlusOne.toISOString(),
        });
        if (!Array.isArray(trips)) trips = [];
      } catch (e: any) {
        log.push(`  ${tech.name}: trip fetch error — ${e.message}`);
        continue;
      }

      if (trips.length === 0) {
        log.push(`  ${tech.name}: no trips this week`);
        continue;
      }

      // Sort trips by start time
      trips.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      // Group trips by day (using tech's timezone — Central time for all)
      const timeZone = 'America/Chicago';
      const tripsByDay = new Map<string, any[]>();

      for (const trip of trips) {
        const localDate = new Date(trip.startTime).toLocaleDateString('en-CA', { timeZone });
        if (!tripsByDay.has(localDate)) tripsByDay.set(localDate, []);
        tripsByDay.get(localDate)!.push(trip);
      }

      // Per-day stats
      const scheduledStartMins = getScheduledStartMinutes(tech.startTime || '8:00 AM');
      const scheduledHours = tech.hrDays || 8;

      let totalMinutesLate = 0;
      let totalUtilization = 0;
      let workDays = 0;

      for (const [date, dayTrips] of tripsByDay) {
        dayTrips.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

        // Find start of day: first trip END that's at a business or customer location
        let startOfDay: Date | null = null;
        let endOfDay: Date | null = null;

        for (const trip of dayTrips) {
          const endpoints = extractTripEndpoints(trip);
          if (!endpoints) continue;

          const tripEnd = new Date(trip.endTime);
          const tripStart = new Date(trip.startTime);

          // Check if trip END is at a business or customer location
          if (startOfDay === null) {
            const bizCheck = isBusinessLocation(endpoints.endLat, endpoints.endLng);
            const custCheck = isCustomerLocation(endpoints.endLat, endpoints.endLng, customerCoords);
            if (bizCheck.match || custCheck) {
              startOfDay = tripEnd;
            }
          }

          // Check if trip START is from a business or customer location (for end of day)
          const bizStartCheck = isBusinessLocation(endpoints.startLat, endpoints.startLng);
          const custStartCheck = isCustomerLocation(endpoints.startLat, endpoints.startLng, customerCoords);
          if (bizStartCheck.match || custStartCheck) {
            endOfDay = tripStart;
          }
        }

        if (!startOfDay || !endOfDay) {
          log.push(`  ${tech.name} ${date}: could not determine start/end of day`);
          continue;
        }

        // Minutes late
        const startMins = getMinutesSinceMidnight(startOfDay, timeZone);
        const minutesLate = startMins - scheduledStartMins;

        // Utilization
        const hoursWorked = (endOfDay.getTime() - startOfDay.getTime()) / (1000 * 60 * 60);
        const utilization = Math.min(hoursWorked / scheduledHours, 1.5); // cap at 150%

        totalMinutesLate += minutesLate;
        totalUtilization += utilization;
        workDays++;

        log.push(`  ${tech.name} ${date}: start=${startOfDay.toLocaleTimeString('en-US', {timeZone})}, end=${endOfDay.toLocaleTimeString('en-US', {timeZone})}, late=${minutesLate.toFixed(0)}min, util=${(utilization*100).toFixed(0)}%`);

        // Save per-day attendance record
        const dateObj = new Date(date + 'T12:00:00.000Z'); // noon UTC to avoid timezone day shift
        await prisma.techDayAttendance.upsert({
          where: { techId_date: { techId: tech.techId, date: dateObj } },
          update: {
            startTime: startOfDay,
            finishTime: endOfDay,
            minutesLate,
            hrsWorked: (endOfDay.getTime() - startOfDay.getTime()) / (1000 * 60 * 60),
            weekEnd,
            status: 'WORKED',
            updatedAt: new Date(),
          },
          create: {
            id: crypto.randomUUID(),
            technicianId: tech.id,
            techId: tech.techId,
            date: dateObj,
            weekEnd,
            office: tech.office,
            team: tech.team,
            routeStartTime: tech.startTime,
            scheduledHrs: tech.hrDays,
            startTime: startOfDay,
            finishTime: endOfDay,
            minutesLate,
            hrsWorked: (endOfDay.getTime() - startOfDay.getTime()) / (1000 * 60 * 60),
            status: 'WORKED',
          },
        });
      }

      if (workDays === 0) {
        log.push(`  ${tech.name}: no valid work days found`);
        continue;
      }

      const avgMinutesLate = totalMinutesLate / workDays;
      const avgUtilization = totalUtilization / workDays;
      const reliabilityScore = calcReliability(avgMinutesLate, avgUtilization);

      log.push(`  → ${tech.techId} reliability: ${reliabilityScore.toFixed(3)} (avgLate=${avgMinutesLate.toFixed(1)}min, avgUtil=${(avgUtilization*100).toFixed(0)}%)`);

      // Upsert tech week
      const existing = await prisma.techWeek.findUnique({
        where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
      });

      const updateData: any = {
        reliabilityScore,
        minutesLate: avgMinutesLate,
        utilization: avgUtilization,
        updatedAt: new Date(),
      };

      // Recalculate total score
      if (existing?.drivingScore !== null && existing?.drivingScore !== undefined) {
        const drv = existing.drivingScore;
        if (tech.team === 'WP' && existing.closeOutPct !== null) {
          const s = calcWPScore(existing.closeOutPct, existing.callbackRate ?? null, drv, reliabilityScore);
          updateData.wpScore = s; updateData.totalScore = s + (existing.manualAdj ?? 0);
        } else if (tech.team === 'PMP' && existing.revenueEfficiency !== null && existing.reseviceRate !== null && existing.completionPct !== null) {
          const s = calcPMPScore(existing.revenueEfficiency, existing.reseviceRate, existing.completionPct, drv, reliabilityScore);
          updateData.pmpScore = s; updateData.totalScore = s + (existing.manualAdj ?? 0);
        } else if (tech.team === 'IP') {
          const s = calcIPScore(drv, reliabilityScore);
          updateData.ipScore = s; updateData.totalScore = s + (existing.manualAdj ?? 0);
        }
      }

      if (existing) {
        await prisma.techWeek.update({
          where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
          data: updateData,
        });
      } else {
        await prisma.techWeek.create({
          data: {
            id: crypto.randomUUID(),
            technicianId: tech.id,
            techId: tech.techId,
            weekEnd,
            office: tech.office,
            team: tech.team,
            siteLeader: tech.siteLeader,
            crewLeader: tech.crewLeader,
            reliabilityScore,
            minutesLate: avgMinutesLate,
            utilization: avgUtilization,
            manualAdj: 0,
          },
        });
      }

      updated++;
    }

  } catch (e: any) {
    errors.push(e.message);
    log.push(`ERROR: ${e.message}`);
  }

  log.push(`\nTotal updated: ${updated}`);

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    weekEnd: fmtDate(weekEnd),
    techsUpdated: updated,
    errors,
    log: log.join('\n'),
  });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return POST(new NextRequest(req.url, { method: 'POST', headers: req.headers, body: '{}' }));
}
