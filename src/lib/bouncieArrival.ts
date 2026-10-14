// Self-contained Bouncie arrival/departure computation for the US Payroll "Clock-In vs Arrival" tool.
// Logic copied from the Field Performance reliability cron (start of day = first trip END at a real stop;
// end of day = last trip START/END at a real stop) but DECOUPLED: it computes on demand for the specific
// techs + dates in an uploaded OnTheClock CSV, reading raw bouncie trips directly — it does NOT read
// TechDayAttendance (which is Fri-week-based and includes ex-employees). All times in America/Chicago.
import { prisma } from '@/lib/prisma';

const BOUNCIE_BASE = 'https://api.bouncie.dev/v1';
const AUTH_BASE = 'https://auth.bouncie.com/oauth/token';
const CLIENT_ID = 'critter-stop-';
const TIME_ZONE = 'America/Chicago';
const GEOFENCE_RADIUS_M = 500;
const BUSINESS_GEOFENCE_RADIUS_M = 300;
const MIN_TRIP_MILES_FOR_STARTOFDAY = 2;

// Business locations where arriving = "at work" (offices, suppliers, big-box stores). Trimmed to the anchors
// that matter for start/end detection; customer stops are matched separately via geocoded customers.
const BUSINESS_LOCATIONS: Array<{ name: string; lat: number; lng: number }> = [
  { name: 'Southlake HQ', lat: 32.9244, lng: -97.1252 },
  { name: 'Haltom City', lat: 32.8121, lng: -97.2698 },
  { name: 'Haltom City Bradley A', lat: 32.7973383, lng: -97.2491626 },
  { name: 'Haltom City Bradley B', lat: 32.7971766, lng: -97.2487747 },
  { name: 'Haltom City Bradley C', lat: 32.7969712, lng: -97.24895 },
  { name: 'Oak Lawn Dallas', lat: 32.8198, lng: -96.8209 },
  { name: 'Richardson', lat: 32.9581813, lng: -96.7170318 },
  { name: 'The Colony', lat: 33.0862, lng: -96.8884 },
  { name: 'Justin', lat: 33.0748, lng: -97.2951 },
  { name: 'Austin Office', lat: 30.3806345, lng: -97.7239255 },
  { name: 'Austin S Capital Office', lat: 30.2874081, lng: -97.82458 },
  { name: 'OKC Office', lat: 35.4442, lng: -97.5198 },
  { name: 'College Station Office', lat: 30.5856, lng: -96.3063 },
  { name: 'Control Source', lat: 33.0417197, lng: -96.9918763 },
  { name: 'Veseris Dallas', lat: 32.8972, lng: -96.7537 },
  { name: 'Veseris Grand Prairie', lat: 32.7459, lng: -97.0208 },
];

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function isBusiness(lat: number, lng: number) {
  for (const loc of BUSINESS_LOCATIONS) if (haversineM(lat, lng, loc.lat, loc.lng) <= BUSINESS_GEOFENCE_RADIUS_M) return loc.name;
  return null;
}
function isCustomer(lat: number, lng: number, coords: Array<{ lat: number; lng: number }>) {
  for (const c of coords) if (haversineM(lat, lng, c.lat, c.lng) <= GEOFENCE_RADIUS_M) return true;
  return false;
}
function extractEndpoints(trip: any): { startLat: number; startLng: number; endLat: number; endLng: number } | null {
  try {
    const gps = trip.gps; if (!gps) return null;
    let coords: number[][] = [];
    if (typeof gps === 'string') coords = (JSON.parse(gps).coordinates) || [];
    else if (gps.coordinates) coords = gps.coordinates;
    else if (Array.isArray(gps)) coords = gps;
    if (coords.length < 2) return null;
    const first = coords[0], last = coords[coords.length - 1];
    return { startLat: first[1], startLng: first[0], endLat: last[1], endLng: last[0] };
  } catch { return null; }
}

// Bouncie OAuth — refresh via stored token (same as reliability cron). Returns a usable access token.
export async function getBouncieToken(): Promise<string> {
  const [tok, exp, ref] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_token_expires_at' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_refresh_token' } }),
  ]);
  if (!tok || !ref) throw new Error('Bouncie not connected');
  const expiresAt = exp ? new Date(exp.value) : new Date(0);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return tok.value;
  const res = await fetch(AUTH_BASE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, client_secret: process.env.BOUNCIE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: ref.value }),
  });
  if (!res.ok) throw new Error(`Bouncie token refresh failed: ${res.status}`);
  const t = await res.json();
  await Promise.all([
    prisma.appSetting.update({ where: { key: 'bouncie_access_token' }, data: { value: t.access_token } }),
    prisma.appSetting.update({ where: { key: 'bouncie_refresh_token' }, data: { value: t.refresh_token } }),
    prisma.appSetting.update({ where: { key: 'bouncie_token_expires_at' }, data: { value: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString() } }),
  ]);
  return t.access_token;
}

async function bouncieFetch(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${BOUNCIE_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'Authorization': token, 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Bouncie ${path} failed: ${res.status}`);
  return res.json();
}

const localDateStr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TIME_ZONE }); // YYYY-MM-DD in Central

export type DayArrival = { date: string; arrival: Date | null; departure: Date | null };

// Compute arrival/departure per day for one vehicle (imei) across a date range. Pulls trips once, groups by
// Central day. Returns a map keyed by YYYY-MM-DD.
export async function computeArrivalsForImei(
  imei: string, token: string, startISO: string, endISO: string,
  customerCoords: Array<{ lat: number; lng: number }>
): Promise<Map<string, DayArrival>> {
  const out = new Map<string, DayArrival>();
  let trips: any[] = [];
  try {
    trips = await bouncieFetch('/trips', token, { imei, 'starts-after': startISO, 'ends-before': endISO, 'gps-format': 'geojson' });
  } catch { return out; }
  if (!Array.isArray(trips)) return out;

  // group by local day
  const byDay = new Map<string, any[]>();
  for (const t of trips) {
    if (!t.startTime) continue;
    const day = localDateStr(new Date(t.startTime));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(t);
  }

  for (const [day, dayTrips] of byDay) {
    dayTrips.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    let startOfDay: Date | null = null, endOfDay: Date | null = null;
    for (const trip of dayTrips) {
      const ep = extractEndpoints(trip); if (!ep) continue;
      const tripEnd = new Date(trip.endTime), tripStart = new Date(trip.startTime);
      const miles = parseFloat(trip.distance || '0');
      if (startOfDay === null) {
        const known = isBusiness(ep.endLat, ep.endLng) || isCustomer(ep.endLat, ep.endLng, customerCoords);
        if (miles < MIN_TRIP_MILES_FOR_STARTOFDAY && !known) continue;
        if (known) startOfDay = tripEnd; else continue;
      }
      // end of day = latest trip start/end at a known location
      if (isBusiness(ep.startLat, ep.startLng) || isCustomer(ep.startLat, ep.startLng, customerCoords)) {
        if (!endOfDay || tripStart > endOfDay) endOfDay = tripStart;
      }
      if (isBusiness(ep.endLat, ep.endLng) || isCustomer(ep.endLat, ep.endLng, customerCoords)) {
        if (startOfDay && tripEnd > startOfDay && (!endOfDay || tripEnd > endOfDay)) endOfDay = tripEnd;
      }
    }
    out.set(day, { date: day, arrival: startOfDay, departure: endOfDay });
  }
  return out;
}
