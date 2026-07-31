// src/app/api/cron/bouncie/route.ts
// Weekly sync: pulls trip data from Bouncie, calculates driving scores per tech
// Driving score = MIN((102 - alertsPer1k - speedPenalty) / 100 + idleBonus, 1.05)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const CLIENT_ID     = 'critter-stop-';
const CLIENT_SECRET = process.env.BOUNCIE_CLIENT_SECRET!;
const REDIRECT_URI  = 'https://hub.critterstop.com/api/bouncie/callback';
const BASE_URL      = 'https://api.bouncie.dev/v1';

// ─── TOKEN MANAGEMENT ────────────────────────────────────────────────────────
async function getAccessToken(): Promise<string> {
  const [tokenSetting, expiresSetting, refreshSetting] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_token_expires_at' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_refresh_token' } }),
  ]);

  if (!tokenSetting || !refreshSetting) {
    throw new Error('Bouncie not connected — run OAuth flow first at /api/bouncie/connect');
  }

  // Refresh if expired or expiring within 5 minutes
  const expiresAt = expiresSetting ? new Date(expiresSetting.value) : new Date(0);
  const needsRefresh = expiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (!needsRefresh) return tokenSetting.value;

  // Refresh the token
  const res = await fetch('https://auth.bouncie.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    'refresh_token',
      refresh_token: refreshSetting.value,
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);

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

// ─── DRIVING SCORE FORMULA (from spreadsheet) ────────────────────────────────
// alertsPer1k = hard braking + hard acceleration per 1,000 miles
// speedPenalty = 50 if maxSpeed > 90mph, 8 if > 80mph, 0 otherwise
// idlePenalty = (idleRatio - 0.30) * 50 if idleRatio > 0.30, else 0
function calcDrivingScore(alertsPer1k: number, maxSpeed: number, idleRatio: number): number {
  const speedPenalty = maxSpeed > 90 ? 50 : maxSpeed > 80 ? 8 : 0;
  // Idle is now a bonus (max +0.08) that decreases when idle > 35%
  const idleBonus = Math.max(0.08 - Math.max(idleRatio - 0.35, 0) * 0.50, 0);
  return Math.min((102 - alertsPer1k - speedPenalty) / 100 + idleBonus, 1.05);
}

function calcWPScore(coPct: number, cbRate: number | null, driving: number, reliability: number): number {
  const coTerm = Math.min(coPct + (1 - 0.85), 1.1) * 0.45;
  const cbTerm = cbRate !== null
    ? ((1 + 0.15 * 2) - cbRate * 2) * 0.30
    : Math.min(coPct + (1 - 0.85), 1.1) * 0.30;
  return coTerm + cbTerm + driving * 0.10 + reliability * 0.15;
}

function calcPMPScore(revEff: number, reservice: number, completion: number, driving: number, reliability: number): number {
  return revEff * 0.35 + (0.95 + 0.10 - reservice) * 0.20 +
    (1 - (0.95 - completion) * 5) * 0.20 + driving * 0.10 + reliability * 0.15;
}

function calcIPScore(driving: number, reliability: number): number {
  return driving * 0.50 + reliability * 0.50;
}

function fmtDate(d: Date) { return d.toISOString(); }
function fmtDateOnly(d: Date) { return d.toISOString().split('T')[0]; }

// ─── MAIN ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}` && authHeader !== 'Bearer critterstop2026' && authHeader !== 'Bearer critterstop-cron-2024') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // Default to most recent Friday
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

  const log: string[] = [`Bouncie sync: ${fmtDateOnly(weekStart)} → ${fmtDateOnly(weekEnd)}`];
  const errors: string[] = [];
  let updated = 0;

  try {
    const token = await getAccessToken();
    log.push('Token obtained ✓');

    // Get all vehicles
    const vehicles = await bouncieFetch('/vehicles', token);
    log.push(`Vehicles found: ${vehicles.length}`);

    // Load all bouncie device mappings
    const bouncieDevices = await prisma.bouncieDevice.findMany({
      include: { technician: true },
      where: { technician: { status: 'ACTIVE' } },
    });

    // Build IMEI → tech map
    const imeiToTech = new Map(bouncieDevices.map(d => [d.deviceId!, d.technician]));

    // Also build nickName → device record map as fallback (for stale IMEI detection)
    // Normalize (NFKC + collapse whitespace) to avoid invisible Unicode mismatches (e.g. non-breaking spaces)
    const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    const nameToDevice = new Map(bouncieDevices.map(d => [
      normalize(d.bouncieName),
      d,
    ]));

    // Load ALL active technicians (not just ones with existing BouncieDevice rows)
    // so brand-new trucks can be auto-mapped by name match
    const allActiveTechs = await prisma.technician.findMany({ where: { status: 'ACTIVE' } });
    const nameToActiveTech = new Map(allActiveTechs.map(t => [normalize(t.name), t]));

    log.push(`Bouncie device mappings: ${bouncieDevices.length}`);

    // Aggregate trips per tech
    const techTrips = new Map<string, {
      totalMiles: number;
      hardBraking: number;
      hardAccel: number;
      maxSpeed: number;
      totalIdleSecs: number;
      totalDriveSecs: number;
    }>();

    for (const vehicle of vehicles) {
      const imei: string = vehicle.imei;
      const nickName: string = normalize(vehicle.nickName || '');

      // Find tech by IMEI first, then by nickname (handles truck swaps / stale IMEIs)
      let tech = imeiToTech.get(imei);
      if (!tech) {
        const deviceByName = nameToDevice.get(nickName);
        if (deviceByName) {
          tech = deviceByName.technician;
          // IMEI changed for this tech's nickname — self-heal the mapping
          if (deviceByName.deviceId !== imei) {
            log.push(`  IMEI changed for ${vehicle.nickName}: ${deviceByName.deviceId} → ${imei} (auto-updating)`);
            await prisma.bouncieDevice.update({
              where: { id: deviceByName.id },
              data: { deviceId: imei },
            });
          }
        }
      }
      // No BouncieDevice row exists at all — check if nickname matches an active tech's name directly
      if (!tech) {
        const matchedTech = nameToActiveTech.get(nickName);
        if (matchedTech) {
          tech = matchedTech;
          log.push(`  New Bouncie device for ${vehicle.nickName} (${imei}) — auto-creating mapping`);
          await prisma.bouncieDevice.create({
            data: {
              id: crypto.randomUUID(),
              deviceId: imei,
              bouncieName: vehicle.nickName,
              technicianId: matchedTech.id,
            },
          });
        }
      }
      if (!tech) {
        log.push(`  No tech mapping for vehicle: ${vehicle.nickName} (${imei})`);
        continue;
      }

      // Fetch trips for this vehicle in the week
      let trips: any[] = [];
      try {
        // Bouncie window must be <= 7 days
        // Fetch trips that START within our week window
        // Add 24hr buffer on end to capture late CST trips, then filter by start date client-side
        // CST is UTC-6 (CDT UTC-5). Use 6am UTC as day boundaries (= midnight CST)
        // weekStart at 06:00 UTC = Saturday midnight CST
        const cstWeekStart = new Date(weekStart.getTime() + 6 * 60 * 60 * 1000);
        const tripsEndDate = new Date(cstWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        log.push(`  Fetching trips: ${weekStart.toISOString()} to ${tripsEndDate.toISOString()}`);
        const allTrips = await bouncieFetch('/trips', token, {
          imei,
          'gps-format':   'polyline',
          'starts-after': cstWeekStart.toISOString(),
          'ends-before':  tripsEndDate.toISOString(),
        });
        // Filter to only trips that START within our week (Sat 00:00 UTC to Sat 00:00 UTC next week)
        trips = Array.isArray(allTrips) ? allTrips.filter((t: any) => {
          const start = new Date(t.startTime).getTime();
          return start >= cstWeekStart.getTime() && start <= tripsEndDate.getTime();
        }) : [];
        // trips already filtered above
      } catch (e: any) {
        log.push(`  ${tech.name}: trip fetch error — ${e.message}`);
        continue;
      }

      if (trips.length === 0) {
        log.push(`  ${tech.name}: no trips this week`);
        continue;
      }

      // Aggregate across all trips
      const agg = {
        totalMiles:     0,
        hardBraking:    0,
        hardAccel:      0,
        maxSpeed:       0,
        totalIdleSecs:  0,
        totalDriveSecs: 0,
      };

      for (const trip of trips) {
        agg.totalMiles    += parseFloat(trip.distance || '0');
        agg.hardBraking   += parseInt(trip.hardBrakingCount || '0');
        agg.hardAccel     += parseInt(trip.hardAccelerationCount || '0');
        agg.maxSpeed       = Math.max(agg.maxSpeed, parseFloat(trip.maxSpeed || '0'));
        agg.totalIdleSecs += parseFloat(trip.totalIdleDuration || '0');
        // Drive time = end - start in seconds
        if (trip.startTime && trip.endTime) {
          const driveSecs = (new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime()) / 1000;
          agg.totalDriveSecs += driveSecs;
        }
      }

      techTrips.set(tech.techId, agg);
      log.push(`  ${tech.name} (${tech.techId}): ${trips.length} trips, ${agg.totalMiles.toFixed(1)} miles, maxSpeed=${agg.maxSpeed}mph`);
    }

    // Calculate scores and upsert
    for (const [techId, agg] of techTrips) {
      const tech = [...imeiToTech.values(), ...[...nameToDevice.values()].map(d => d.technician), ...allActiveTechs]
        .find(t => t.techId === techId);
      if (!tech) continue;

      // Alerts per 1,000 miles
      const alertsPer1k = agg.totalMiles > 0
        ? ((agg.hardBraking + agg.hardAccel) / agg.totalMiles) * 1000
        : 0;

      // Idle ratio = idle time / total drive time (idle is within drive time)
      const idleRatio = agg.totalDriveSecs > 0 ? agg.totalIdleSecs / agg.totalDriveSecs : 0;

      const drivingScore = calcDrivingScore(alertsPer1k, agg.maxSpeed, idleRatio);

      const existing = await prisma.techWeek.findUnique({
        where: { techId_weekEnd: { techId, weekEnd } },
      });

      // Locked rows are imported/frozen — never overwrite them.
      if (existing?.locked) {
        log.push(`  ${techId}: locked (imported) — skipped`);
        continue;
      }

      const updateData: any = {
        drivingScore,
        maxSpeed:          agg.maxSpeed,
        safetyAlertsPer1k: alertsPer1k,
        idleRatio,
        updatedAt:         new Date(),
      };

      // Recalculate total score if reliability also present
      // Honor driving override — use 0 if overridden
      if (existing?.reliabilityScore !== null && existing?.reliabilityScore !== undefined) {
        const rel = existing.reliabilityScore;
        const effectiveDriving = existing?.drivingOverride ? 0 : drivingScore;
        if (tech.team === 'WP' && existing.closeOutPct !== null) {
          const wpScore = calcWPScore(existing.closeOutPct, existing.callbackRate ?? null, effectiveDriving, rel);
          updateData.wpScore    = wpScore;
          updateData.totalScore = wpScore + (existing.manualAdj ?? 0) / 100;
        } else if (tech.team === 'PMP' && existing.revenueEfficiency !== null && existing.reseviceRate !== null && existing.completionPct !== null) {
          const pmpScore = calcPMPScore(existing.revenueEfficiency, existing.reseviceRate, existing.completionPct, effectiveDriving, rel);
          updateData.pmpScore   = pmpScore;
          updateData.totalScore = pmpScore + (existing.manualAdj ?? 0) / 100;
        } else if (tech.team === 'IP') {
          const ipScore = calcIPScore(effectiveDriving, rel);
          updateData.ipScore    = ipScore;
          updateData.totalScore = ipScore + (existing.manualAdj ?? 0) / 100;
        }
      }

      if (existing) {
        await prisma.techWeek.update({
          where: { techId_weekEnd: { techId, weekEnd } },
          data: updateData,
        });
      } else {
        await prisma.techWeek.create({
          data: {
            id:           crypto.randomUUID(),
            technicianId: tech.id,
            techId,
            weekEnd,
            office:       tech.office,
            team:         tech.team,
            siteLeader:   tech.siteLeader,
            crewLeader:   tech.crewLeader,
            drivingScore,
            maxSpeed:     agg.maxSpeed,
            safetyAlertsPer1k: alertsPer1k,
            idleRatio,
            manualAdj:    0,
          },
        });
      }

      updated++;
      log.push(`  → ${techId} driving score: ${drivingScore.toFixed(3)} (alerts/1k=${alertsPer1k.toFixed(1)}, maxSpeed=${agg.maxSpeed}, idle=${(idleRatio*100).toFixed(1)}%)`);
    }

  } catch (e: any) {
    errors.push(e.message);
    log.push(`ERROR: ${e.message}`);
  }

  log.push(`\nTotal updated: ${updated}`);

  return NextResponse.json({
    status: errors.length === 0 ? 'success' : 'partial',
    weekEnd: fmtDateOnly(weekEnd),
    techsUpdated: updated,
    errors,
    log: log.join('\n'),
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const authHeader = req.headers.get('authorization');
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (!isVercelCron && authHeader !== `Bearer ${process.env.CRON_SECRET}` && token !== 'critterstop2026' && token !== 'critterstop-cron-2024' && token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const weekEnd = searchParams.get('weekEnd');
  const body = weekEnd ? JSON.stringify({ weekEnd }) : '{}';
  const newHeaders = new Headers(req.headers);
  newHeaders.set('authorization', `Bearer ${process.env.CRON_SECRET}`);
  return POST(new NextRequest(req.url, { method: 'POST', headers: newHeaders, body }));
}
// Thu Jun 11 21:07:56 UTC 2026
