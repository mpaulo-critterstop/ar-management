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

// ─── FIELDROUTES CONFIG ───────────────────────────────────────────────────────
const FR_SUBDOMAIN = 'critterstoppest';
const FR_BASE      = `https://${FR_SUBDOMAIN}.fieldroutes.com/api`;
const FR_OFFICES: Record<string, { key: string; token: string; officeId: number }> = {
  DFW:   { key: process.env.FIELDROUTES_KEY_DFW!,   token: process.env.FIELDROUTES_TOKEN_DFW!,   officeId: 1 },
  ATX:   { key: process.env.FIELDROUTES_KEY_ATX!,   token: process.env.FIELDROUTES_TOKEN_ATX!,   officeId: 5 },
  OKC:   { key: process.env.FIELDROUTES_KEY_OKC!,   token: process.env.FIELDROUTES_TOKEN_OKC!,   officeId: 3 },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT!, officeId: 4 },
};

// Animal relocation service type IDs — Saturday-only trips with ONLY these are excluded
const ANIMAL_RELOCATION_SERVICE_IDS = new Set([485, 684, 685, 690, 691, 1039]);

function frUrl(endpoint: string, action: string, params: Record<string, string>, key: string, token: string) {
  const url = new URL(`${FR_BASE}/${endpoint}/${action}`);
  url.searchParams.set('authenticationKey', key);
  url.searchParams.set('authenticationToken', token);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function frFetch(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FR fetch failed: ${res.status}`);
  return res.json();
}

// Returns true if ALL of a tech's appointments on a given date are animal relocation types
// Returns false if there are non-animal appointments OR no appointments found
async function isSaturdayAnimalOnlyDay(
  techFREmployeeId: number,
  date: string, // YYYY-MM-DD
  office: string
): Promise<boolean> {
  const cfg = FR_OFFICES[office];
  if (!cfg || !techFREmployeeId) return false;

  try {
    const searchUrl = frUrl('appointment', 'search', {
      employeeIDs: String(techFREmployeeId),
      dateStart: date,
      dateEnd: date,
    }, cfg.key, cfg.token);

    const searchData = await frFetch(searchUrl);
    const apptIds: number[] = searchData.appointmentIDs || [];
    if (apptIds.length === 0) return true; // no appointments on Saturday = skip (likely animal relocation or off day)

    // Fetch appointment details
    const batchUrl = frUrl('appointment', 'get', {
      appointmentIDs: apptIds.join(','),
    }, cfg.key, cfg.token);
    const appts = await frFetch(batchUrl);
    const apptList = Array.isArray(appts) ? appts : (appts.appointments || []);

    if (apptList.length === 0) return true; // on Saturday with no appointment details, skip

    // Check if ALL appointments are animal relocation service types
    const allAnimal = apptList.every((a: any) => {
      const typeId = parseInt(String(a.type || a.serviceTypeID || '0'));
      return ANIMAL_RELOCATION_SERVICE_IDS.has(typeId);
    });

    // Debug: log first appointment fields for troubleshooting
    if (!allAnimal && apptList.length > 0) {
      const a = apptList[0];
      throw new Error(`DEBUG: apptId=${a.appointmentID}, type=${a.type}, serviceTypeID=${a.serviceTypeID}, typeId=${parseInt(String(a.type || a.serviceTypeID || '0'))}`);
    }

    return allAnimal;
  } catch {
    return false; // on error, don't skip — safer to include
  }
}

// ─── BUSINESS LOCATIONS ──────────────────────────────────────────────────────
const BUSINESS_LOCATIONS = [
  // DFW Offices
  { name: 'Southlake HQ',          lat: 32.9244,  lng: -97.1252 },
  { name: 'Haltom City',           lat: 32.8121,  lng: -97.2698 },
  { name: 'Haltom City Bradley A', lat: 32.7973383, lng: -97.2491626 },
  { name: 'Haltom City Bradley B', lat: 32.7971766, lng: -97.2487747 },
  { name: 'Haltom City Bradley C', lat: 32.7969712, lng: -97.2489500 },
  { name: 'Oak Lawn Dallas',        lat: 32.8198,  lng: -96.8209 },
  { name: 'Richardson',             lat: 32.9581813, lng: -96.7170318 },
  { name: 'The Colony',             lat: 33.0862,  lng: -96.8884 },
  { name: 'Justin',                 lat: 33.0748,  lng: -97.2951 },
  // ATX
  { name: 'Austin Office',          lat: 30.3806345, lng: -97.7239255 },
  { name: 'Austin S Capital Office', lat: 30.2874081, lng: -97.82458 },
  // OKC
  { name: 'OKC Office',             lat: 35.4442,  lng: -97.5198 },
  // CStat
  { name: 'College Station Office', lat: 30.5856,  lng: -96.3063 },
  // Suppliers
  { name: 'Control Source',         lat: 33.0417197, lng: -96.9918763 },
  { name: 'Veseris Dallas',         lat: 32.8972,  lng: -96.7537 },
  { name: 'Veseris Grand Prairie',  lat: 32.7459,  lng: -97.0208 },
  // Home Depot DFW
  { name: 'Home Depot Dallas FW Ave',    lat: 32.7560, lng: -96.8645 },
  { name: 'Home Depot Irving 8555',      lat: 32.9234, lng: -96.9804 },
  { name: 'Home Depot Irving 3200',      lat: 32.8336, lng: -96.9911 },
  { name: 'Home Depot Dallas Lemmon',    lat: 32.8340, lng: -96.8275 },
  { name: 'Home Depot Dallas Grissom',   lat: 32.9080, lng: -96.8845 },
  { name: 'Home Depot Euless',           lat: 32.8348, lng: -97.0982 },
  { name: 'Home Depot Dallas Skillman',  lat: 32.8607, lng: -96.7497 },
  { name: 'Home Depot FW N Fwy',         lat: 32.8704, lng: -97.3130 },
  { name: 'Home Depot FW S Fwy',         lat: 32.6332, lng: -97.3239 },
  { name: 'Home Depot Plano',            lat: 33.0990, lng: -96.7943 },
  { name: 'Home Depot Lewisville',       lat: 33.0538, lng: -97.0128 },
  { name: 'Home Depot Flower Mound',     lat: 32.9927, lng: -97.0606 },
  // Lowes DFW
  { name: 'Lowes Dallas Lemmon',         lat: 32.8306, lng: -96.8288 },
  { name: 'Lowes Dallas Chalk Hill',     lat: 32.7645, lng: -96.9012 },
  { name: 'Lowes Euless',                lat: 32.8800, lng: -97.0962 },
  { name: 'Lowes Dallas Inwood',         lat: 32.9118, lng: -96.8166 },
  { name: 'Lowes Southlake',             lat: 32.9417, lng: -97.1139 },
  { name: 'Lowes Keller',                lat: 32.8975, lng: -97.2393 },
  { name: 'Lowes FW Eastchase',          lat: 32.7640, lng: -97.1654 },
  { name: 'Lowes Hurst',                 lat: 32.8586, lng: -97.1837 },
  { name: 'Lowes Dallas Preston',        lat: 33.0105, lng: -96.7914 },
  { name: 'Lowes McKinney',              lat: 33.1293, lng: -96.7258 },
  { name: 'Lowes Allen',                 lat: 33.1023, lng: -96.6860 },
  { name: 'Lowes Frisco',                lat: 33.1064, lng: -96.8028 },
  { name: 'Lowes Plano',                 lat: 33.0534, lng: -96.6983 },
  { name: 'Lowes Denton',                lat: 33.1969, lng: -97.0903 },
  { name: 'Lowes Lewisville',            lat: 33.0575, lng: -97.0154 },
  { name: 'Lowes Flower Mound',          lat: 33.0710, lng: -97.0810 },
  { name: 'Lock N Roll Storage CStat',    lat: 30.6326484, lng: -96.3017319 },
  { name: 'Home Depot Brenham',           lat: 30.1396086, lng: -96.3899173 },
  { name: 'Home Depot Austin Lakeline',  lat: 30.4770023, lng: -97.7987743 },
  { name: 'Home Depot Austin Lakeline',  lat: 30.4782697, lng: -97.7988762 },
  { name: 'Home Depot Austin Lakeline',  lat: 30.478351,  lng: -97.799633  },
  { name: 'Home Depot Austin Lakeline',  lat: 30.478425,  lng: -97.797916  },
  { name: 'Home Depot Austin Lakeline',  lat: 30.478952,  lng: -97.799037  },
  { name: 'Home Depot Austin S I-35',     lat: 30.2221031, lng: -97.7495362 },
  { name: 'Home Depot Austin Barbara Jordan', lat: 30.3077956, lng: -97.7098452 },
  { name: 'Home Depot Austin N Mopac',    lat: 30.3934426, lng: -97.7317976 },
  { name: 'Home Depot OKC S Shields',     lat: 35.393434,  lng: -97.5044463 },
  { name: 'Home Depot OKC W Reno',        lat: 35.4635096, lng: -97.6317504 },
  { name: 'Home Depot OKC NW 59th',       lat: 35.5312716, lng: -97.5695585 },
  { name: 'Lowes College Station',        lat: 30.562449,  lng: -96.257062  },
  { name: 'Lowes Bryan',                  lat: 30.658349,  lng: -96.326184  },
  { name: 'Lowes Brenham',                lat: 30.140455,  lng: -96.398038  },
  { name: 'Lowes Austin Shoal Creek',     lat: 30.3656,    lng: -97.74030   },
  { name: 'Lowes Austin N I-35',          lat: 30.415364,  lng: -97.675614  },
  { name: 'Lowes Austin S I-35',          lat: 30.200783,  lng: -97.764880  },
  { name: 'Lowes OKC I-240',              lat: 35.389025,  lng: -97.514252  },
  { name: 'Lowes OKC N May',              lat: 35.510004,  lng: -97.567623  },
  { name: 'Lowes OKC W Memorial',         lat: 35.606458,  lng: -97.556346  },
];

const GEOFENCE_RADIUS_M = 500;          // customer locations
const BUSINESS_GEOFENCE_RADIUS_M = 300; // business locations (large parking lots, GPS drift)
const MIN_TRIP_MILES_FOR_STARTOFDAY = 1.0; // ignore trips under 1 mile when finding start of day

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
    if (dist <= BUSINESS_GEOFENCE_RADIUS_M) return { match: true, name: loc.name };
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
      where: { technician: { status: 'ACTIVE' } },
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

    // Load per-tech per-day route customer cache
    const techRouteCoords = new Map<string, Array<{ lat: number; lng: number; customerId?: string; frAppointmentId?: string }>>();
    for (const officeName of Object.keys(FR_OFFICES)) {
      // Load each day's cache: rc_customers_<office>_<date>
      const dayDate = new Date(weekStart);
      while (dayDate <= weekEnd) {
        const dateStr = dayDate.toISOString().split('T')[0];
        const cacheKey = `rc_customers_${officeName}_${dateStr}`;
        try {
          const cached = await prisma.appSetting.findUnique({ where: { key: cacheKey } });
          if (cached?.value) {
            const map: Record<string, Array<{ lat: number; lng: number; customerId?: string; frAppointmentId?: string }>> = JSON.parse(cached.value);
            for (const [techId, coords] of Object.entries(map)) {
              techRouteCoords.set(`${techId}_${dateStr}`, coords);
            }
          }
        } catch (e: any) {
          log.push(`Route cache load error for ${officeName} ${dateStr}: ${e.message}`);
        }
        dayDate.setDate(dayDate.getDate() + 1);
      }
    }
    log.push(`Loaded per-day route customer cache: ${techRouteCoords.size} tech-day entries`);

    // Process each vehicle
    for (const vehicle of vehicles) {
      const imei: string = vehicle.imei;
      const nickName: string = (vehicle.nickName || '').toLowerCase();

      let tech = imeiToTech.get(imei) as any;
      if (!tech) tech = nameToTech.get(nickName) as any;
      if (!tech) continue;

      // Fetch trips for the week with geojson GPS
      // Window: 6AM UTC Monday to 6AM UTC Saturday = midnight CST Monday to midnight CST Saturday
      // Exactly 7 days — stays within Bouncie's limit while capturing full CST days
      let trips: any[] = [];
      try {
        const bouncieStart = new Date(weekStart.getTime() + 6 * 60 * 60 * 1000); // weekStart + 6hrs = 6AM UTC Mon
        const bouncieEnd = new Date(weekEnd.getTime() + 30 * 60 * 60 * 1000);    // weekEnd + 30hrs = 6AM UTC Sat = midnight CST Fri
        trips = await bouncieFetch('/trips', token, {
          imei,
          'gps-format':   'geojson',
          'starts-after': bouncieStart.toISOString(),
          'ends-before':  bouncieEnd.toISOString(),
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

      // Use route-specific customer coords if available
      // If no route cache for this tech, fall back to combined pool of ALL other techs' route customers
      // matchCoords will be resolved per-day inside the day loop
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

        // Build matchCoords: own day customers + other techs' day customers (same day only)
        // This handles techs who have 1-2 own customers but spend rest of day helping other techs
        const dayRouteCoords = techRouteCoords.get(`${tech.techId}_${date}`) || [];
        const otherDayCoords: Array<{ lat: number; lng: number; customerId?: string; frAppointmentId?: string }> = [];
        for (const [key, coords] of techRouteCoords.entries()) {
          if (key.endsWith(`_${date}`) && !key.startsWith(`${tech.techId}_`)) {
            otherDayCoords.push(...coords);
          }
        }
        const combinedDayCoords = [...dayRouteCoords, ...otherDayCoords];
        const matchCoords = combinedDayCoords.length > 0 ? combinedDayCoords : customerCoords;

        if (dayRouteCoords.length > 0) {
          log.push(`  ${tech.name}: using ${dayRouteCoords.length} own + ${otherDayCoords.length} other techs' route customers for ${date}`);
        } else {
          log.push(`  ${tech.name}: no own route for ${date} — using ${otherDayCoords.length} combined route customers from other techs`);
        }

        // ── SUNDAY: always skip ──
        const dayOfWeek = new Date(date + 'T12:00:00.000Z').getDay(); // 0=Sun, 6=Sat
        if (dayOfWeek === 0) {
          log.push(`  ${tech.name} ${date}: Sunday — skipped`);
          continue;
        }

        // ── SATURDAY: skip if tech's only appointments are animal relocation ──
        if (dayOfWeek === 6) {
          const frEmpId = tech.frEmployeeId;
          if (frEmpId) {
            const animalOnly = await isSaturdayAnimalOnlyDay(frEmpId, date, tech.office);
            log.push(`  ${tech.name} ${date}: Saturday check — frEmpId=${frEmpId}, animalOnly=${animalOnly}`);
            if (animalOnly) {
              log.push(`  ${tech.name} ${date}: Saturday animal relocation only — skipped`);
              continue;
            }
          } else {
            // WP techs without frEmployeeId: skip Saturday entirely
            // They don't have regular Saturday routes so any GPS activity is likely animal relocation
            log.push(`  ${tech.name} ${date}: Saturday skipped (no frEmployeeId — likely animal relocation)`);
            continue;
          }
        }

        // Find start of day: first trip END that's at a business or customer location
        let startOfDay: Date | null = null;
        let endOfDay: Date | null = null;

        for (let tripIdx = 0; tripIdx < dayTrips.length; tripIdx++) {
          const trip = dayTrips[tripIdx];
          const endpoints = extractTripEndpoints(trip);
          if (!endpoints) continue;

          const tripEnd = new Date(trip.endTime);
          const tripStart = new Date(trip.startTime);
          const tripMiles = parseFloat(trip.distance || '0');

          // ── START OF DAY: first trip end at a known location ──
          if (startOfDay === null) {
            const bizCheck = isBusinessLocation(endpoints.endLat, endpoints.endLng);
            const custCheck = isCustomerLocation(endpoints.endLat, endpoints.endLng, matchCoords);
            const isKnown = bizCheck.match || custCheck;

            // Skip short trips ONLY if the endpoint is unknown (likely home/driveway movement)
            // If endpoint is a known customer/business, use it regardless of distance
            if (tripMiles < MIN_TRIP_MILES_FOR_STARTOFDAY && !isKnown) {
              log.push(`    ${date} skip short trip to unknown addr ${tripStart.toLocaleTimeString('en-US',{timeZone})} (${tripMiles.toFixed(1)} mi)`);
              continue;
            }

            if (isKnown) {
              startOfDay = tripEnd;
              log.push(`    ${date} start matched: ${tripEnd.toLocaleTimeString('en-US',{timeZone})} (${bizCheck.name || 'customer'}, ${tripMiles.toFixed(1)} mi)`);
            } else {
              // Address not in system yet — skip and check next trip
              log.push(`    ${date} skip unknown address at ${tripEnd.toLocaleTimeString('en-US',{timeZone})} lat=${endpoints.endLat.toFixed(4)},lng=${endpoints.endLng.toFixed(4)} (${tripMiles.toFixed(1)} mi)`);
              continue;
            }
          }

          // ── END OF DAY: latest trip start OR end at a known location ──
          const bizStartCheck = isBusinessLocation(endpoints.startLat, endpoints.startLng);
          const custStartCheck = isCustomerLocation(endpoints.startLat, endpoints.startLng, matchCoords);
          if (bizStartCheck.match || custStartCheck) {
            if (!endOfDay || tripStart > endOfDay) endOfDay = tripStart;
          }

          const bizEndCheck = isBusinessLocation(endpoints.endLat, endpoints.endLng);
          const custEndCheck = isCustomerLocation(endpoints.endLat, endpoints.endLng, matchCoords);
          if (bizEndCheck.match || custEndCheck) {
            // Only use trip end if it's after start of day and after current endOfDay
            if (startOfDay && tripEnd > startOfDay && (!endOfDay || tripEnd > endOfDay)) {
              endOfDay = tripEnd;
            }
          }
        }

        if (!startOfDay || !endOfDay) {
          log.push(`  ${tech.name} ${date}: could not determine start/end of day`);
          continue;
        }

        // ── DWELL TIME: calculate time spent at each customer location ──
        // For each trip that ends at a route customer, the dwell time is the gap
        // between that trip's end and the next trip's start (time parked at customer)
        if (dayRouteCoords && dayRouteCoords.length > 0) {
          const dwellUpdates: Array<{ frAppointmentId: string; mins: number }> = [];

          for (let i = 0; i < dayTrips.length - 1; i++) {
            const trip = dayTrips[i];
            const nextTrip = dayTrips[i + 1];
            const endpoints = extractTripEndpoints(trip);
            if (!endpoints) continue;

            // Check if this trip ends at a route customer
            const matchedCustomer = dayRouteCoords.find((c: any) =>
              c.frAppointmentId &&
              haversineDistance(endpoints.endLat, endpoints.endLng, c.lat, c.lng) <= GEOFENCE_RADIUS_M
            );

            if (matchedCustomer?.frAppointmentId) {
              const arrivalTime = new Date(trip.endTime);
              const departureTime = new Date(nextTrip.startTime);
              const dwellMins = (departureTime.getTime() - arrivalTime.getTime()) / 60000;

              // Only record reasonable dwell times (1 min to 4 hours)
              if (dwellMins >= 1 && dwellMins <= 240) {
                dwellUpdates.push({ frAppointmentId: matchedCustomer.frAppointmentId, mins: dwellMins });
              }
            }
          }

          // Update timeAtJobMins for each matched appointment
          for (const { frAppointmentId, mins } of dwellUpdates) {
            await prisma.tcAppointment.updateMany({
              where: { frAppointmentId },
              data: { timeAtJobMins: mins },
            });
          }
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

        // Save per-day attendance record — skip if manually overridden
        const dateObj = new Date(date + 'T12:00:00.000Z'); // noon UTC to avoid timezone day shift
        const existingRecord = await prisma.techDayAttendance.findUnique({
          where: { techId_date: { techId: tech.techId, date: dateObj } },
          select: { manualOverride: true },
        });
        if (existingRecord?.manualOverride) {
          log.push(`  ${tech.name} ${date}: skipped — manually overridden`);
        } else {
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

    // ── FR FALLBACK: attendance for techs without Bouncie ──────────────────────
    const bouncieTechIds = new Set(bouncieDevices.map(d => d.technician.techId));
    const techsWithoutBouncie = await prisma.technician.findMany({
      where: {
        status: 'ACTIVE',
        frEmployeeId: { not: null },
        techId: { notIn: [...bouncieTechIds] },
      },
    });

    log.push(`\nFR fallback: ${techsWithoutBouncie.length} techs without Bouncie`);

    // Wait for FR rate limit to reset before making more FR calls
    log.push('Waiting 65s for FR rate limit reset...');
    await new Promise(r => setTimeout(r, 65000));

    // Group by office to minimize API calls
    const officeGroups = new Map<string, typeof techsWithoutBouncie>();
    for (const tech of techsWithoutBouncie) {
      if (!officeGroups.has(tech.office)) officeGroups.set(tech.office, []);
      officeGroups.get(tech.office)!.push(tech);
    }

    for (const [officeName, officeTechs] of officeGroups) {
      const cfg = FR_OFFICES[officeName];
      if (!cfg) continue;

      // Build frEmployeeId → tech map for this office
      const frIdToTech = new Map(officeTechs.map(t => [t.frEmployeeId!, t]));
      const frIds = new Set(officeTechs.map(t => t.frEmployeeId!));

      try {
        // Fetch all appointments for office/week once
        const searchUrl = frUrl('appointment', 'search', {
          officeIDs: String(cfg.officeId),
          dateStart: fmtDate(weekStart),
          dateEnd: fmtDate(weekEnd),
        }, cfg.key, cfg.token);
        const searchData = await frFetch(searchUrl);
        const apptIds: number[] = searchData.appointmentIDs || [];
        log.push(`  ${officeName}: FR search returned ${apptIds.length} appt IDs (success=${searchData.success}, error=${searchData.errorMessage || 'none'})`);
        if (apptIds.length === 0) {
          continue;
        }
        // Fetch appointment details in batches
        const allAppts: any[] = [];
        for (let i = 0; i < apptIds.length; i += 100) {
          const batch = apptIds.slice(i, i + 100);
          const url = frUrl('appointment', 'get', { appointmentIDs: batch.join(',') }, cfg.key, cfg.token);
          const data = await frFetch(url);
          allAppts.push(...(data.appointments || []));
          await new Promise(r => setTimeout(r, 300));
        }

        // Filter to completed appointments with times, belonging to our techs
        // Use checkIn/checkOut (actual check-in time) over timeIn/timeOut
        const completed = allAppts.filter((a: any) =>
          String(a.status) === '1' &&
          (a.checkIn || a.timeIn) &&
          (a.checkOut || a.timeOut) &&
          frIds.has(parseInt(a.servicedBy || a.employeeID || '0'))
        );

        log.push(`  ${officeName}: ${allAppts.length} total appts, ${completed.length} with times for FR fallback techs`);

        // Group by tech then by day (FR checkIn is actual check-in time, CST local string)
        const techDayAppts = new Map<number, Map<string, any[]>>();
        const timeZone = 'America/Chicago';
        for (const appt of completed) {
          const empId = parseInt(appt.servicedBy || appt.employeeID || '0');
          const timeIn = appt.checkIn || appt.timeIn; // prefer checkIn (actual check-in time)
          // FR times are CST local strings — parse with -05:00 offset
          const cstDate = new Date(timeIn.replace(' ', 'T') + '-05:00');
          const localDate = cstDate.toLocaleDateString('en-CA', { timeZone });
          if (!techDayAppts.has(empId)) techDayAppts.set(empId, new Map());
          const dayMap = techDayAppts.get(empId)!;
          if (!dayMap.has(localDate)) dayMap.set(localDate, []);
          dayMap.get(localDate)!.push(appt);
        }

        // Process each tech
        for (const [empId, dayMap] of techDayAppts) {
          const tech = frIdToTech.get(empId) as any;
          if (!tech) continue;

          let workDays = 0;
          let totalMinutesLate = 0;
          let totalUtilization = 0;

          for (const [dateStr, appts] of dayMap) {
            // FR times are local CST strings (no timezone suffix) — parse as CST by appending offset
            const parseCST = (s: string) => new Date(s.replace(' ', 'T') + '-05:00').getTime();
            const timeIns = appts.map((a: any) => { const v = a.checkIn || a.timeIn; return v ? parseCST(v) : 0; }).filter(Boolean);
            const timeOuts = appts.map((a: any) => { const v = a.checkOut || a.timeOut; return v ? parseCST(v) : 0; }).filter(Boolean);
            if (timeIns.length === 0 || timeOuts.length === 0) continue;

            const startOfDay = new Date(Math.min(...timeIns));
            const endOfDay = new Date(Math.max(...timeOuts));
            const dateObj = new Date(dateStr + 'T12:00:00.000Z');

            // Calculate minutes late
            // FR times are CST local strings parsed with -05:00 offset
            const scheduledStart = tech.startTime || '7:00 AM';
            const [timePart, period] = scheduledStart.split(' ');
            const [h, m] = timePart.split(':').map(Number);
            let scheduledHour = h;
            if (period === 'PM' && h !== 12) scheduledHour += 12;
            if (period === 'AM' && h === 12) scheduledHour = 0;
            // Build scheduled time as CST with -05:00 offset to match FR times
            const scheduledDate = new Date(`${dateStr}T${String(scheduledHour).padStart(2,'0')}:${String(m || 0).padStart(2,'0')}:00-05:00`);
            const minutesLate = (startOfDay.getTime() - scheduledDate.getTime()) / 60000;

            const hrsWorked = (endOfDay.getTime() - startOfDay.getTime()) / (1000 * 60 * 60);
            const scheduledHrs = tech.hrDays || 8;
            const utilization = Math.min(hrsWorked / scheduledHrs, 1.2);

            totalMinutesLate += minutesLate;
            totalUtilization += utilization;
            workDays++;

            const existing2 = await prisma.techDayAttendance.findUnique({
              where: { techId_date: { techId: tech.techId, date: dateObj } },
              select: { manualOverride: true },
            });
            if (!existing2?.manualOverride) {
            await prisma.techDayAttendance.upsert({
              where: { techId_date: { techId: tech.techId, date: dateObj } },
              update: { startTime: startOfDay, finishTime: endOfDay, minutesLate, hrsWorked, weekEnd, status: 'WORKED', updatedAt: new Date() },
              create: {
                id: crypto.randomUUID(),
                technicianId: tech.id,
                techId: tech.techId,
                date: dateObj,
                weekEnd,
                office: tech.office,
                team: tech.team,
                routeStartTime: tech.startTime,
                scheduledHrs,
                startTime: startOfDay,
                finishTime: endOfDay,
                minutesLate,
                hrsWorked,
                status: 'WORKED',
              },
            });
            }
          }

          if (workDays === 0) {
            log.push(`  ${tech.name}: no valid work days from FR`);
            continue;
          }

          const avgMinutesLate = totalMinutesLate / workDays;
          const avgUtilization = totalUtilization / workDays;
          const reliabilityScore = calcReliability(avgMinutesLate, avgUtilization);

          log.push(`  ${tech.name} (FR): reliability=${reliabilityScore.toFixed(3)}, avgLate=${avgMinutesLate.toFixed(1)}min, workDays=${workDays}`);

          const existing = await prisma.techWeek.findUnique({
            where: { techId_weekEnd: { techId: tech.techId, weekEnd } },
          });

          const updateData: any = { reliabilityScore, minutesLate: avgMinutesLate, utilization: avgUtilization, updatedAt: new Date() };

          if (existing?.drivingScore !== null && existing?.drivingScore !== undefined) {
            const drv = existing.drivingScore;
            if (tech.team === 'PMP' && existing.revenueEfficiency !== null && existing.reseviceRate !== null && existing.completionPct !== null) {
              const s = calcPMPScore(existing.revenueEfficiency, existing.reseviceRate, existing.completionPct, drv, reliabilityScore);
              updateData.pmpScore = s; updateData.totalScore = s + (existing.manualAdj ?? 0);
            }
          }

          if (existing) {
            await prisma.techWeek.update({ where: { techId_weekEnd: { techId: tech.techId, weekEnd } }, data: updateData });
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
        log.push(`  ${officeName} FR fallback error: ${e.message}`);
      }
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
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && token !== 'critterstop2026' && token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const weekEnd = searchParams.get('weekEnd');
  const body = weekEnd ? JSON.stringify({ weekEnd }) : '{}';
  const headers = new Headers(req.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('authorization', `Bearer ${process.env.CRON_SECRET}`);
  return POST(new NextRequest(req.url, { method: 'POST', headers, body }));
}
// Thu Jun 18 16:56:37 UTC 2026
