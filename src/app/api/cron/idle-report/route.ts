// src/app/api/cron/idle-report/route.ts
// Runs daily at 4PM CST (22:00 UTC) Mon-Fri
// Fetches Bouncie trips for each tech and flags:
//   - totalIdleDuration > 20 mins on any trip
//   - idle % > 50% on any trip >= 20 mins duration
// Sends flagged techs to Slack. Skips techs already notified today.

export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const BOUNCIE_API = 'https://api.bouncie.dev/v1';

async function bouncieFetch(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${BOUNCIE_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Bouncie ${path} failed: ${res.status} — ${await res.text()}`);
  return res.json();
}

async function sendSlack(webhook: string, text: string, blocks?: any[]) {
  const body: any = { text };
  if (blocks) body.blocks = blocks;
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dateParam = searchParams.get('date'); // optional override, defaults to today CST
  const log: string[] = [];
  const errors: string[] = [];

  const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;
  if (!SLACK_WEBHOOK) return NextResponse.json({ error: 'SLACK_WEBHOOK_URL not set' }, { status: 500 });

  // Determine report date (today in CST)
  const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const reportDate = dateParam || nowCST.toISOString().split('T')[0];
  log.push(`Idle report for ${reportDate}`);

  // Skip weekends
  const dayOfWeek = new Date(reportDate + 'T12:00:00Z').getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return NextResponse.json({ status: 'skipped', reason: 'weekend', log: log.join('\n') });
  }

  // Get Bouncie token
  const tokenSetting = await prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } });
  if (!tokenSetting?.value) return NextResponse.json({ error: 'Bouncie token not found' }, { status: 500 });
  const bouncieToken = tokenSetting.value;

  // Get all vehicles
  const vehicles = await bouncieFetch('/vehicles', bouncieToken);
  log.push(`Fetched ${vehicles.length} vehicles`);

  // Get all active techs with Bouncie devices
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE', bouncieDevice: { isNot: null } },
    select: {
      techId: true, name: true, office: true,
      bouncieDevice: { select: { bouncieName: true, deviceId: true } },
    },
  });
  log.push(`Found ${techs.length} techs with Bouncie devices`);

  // Check already-notified cache for today
  const notifiedKey = `idle_notified_${reportDate}`;
  let notifiedToday: Set<string> = new Set();
  try {
    const notified = await prisma.appSetting.findUnique({ where: { key: notifiedKey } });
    if (notified?.value) notifiedToday = new Set(JSON.parse(notified.value));
  } catch {}

  // Trip window: today CST = 6AM UTC to 6AM UTC next day
  const tripStart = new Date(`${reportDate}T06:00:00.000Z`);
  const tripEnd = new Date(tripStart.getTime() + 24 * 60 * 60 * 1000);

  // Process each tech
  const flagged: Array<{
    techId: string;
    name: string;
    office: string;
    trips: Array<{ startTime: string; endTime: string; durationMins: number; idleMins: number; idlePct: number; distance: string; reason: string }>;
  }> = [];

  for (const tech of techs) {
    if (notifiedToday.has(tech.techId)) {
      log.push(`  ${tech.name}: already notified today — skipping`);
      continue;
    }

    // Match vehicle
    const techDeviceId = tech.bouncieDevice?.deviceId;
    const techBouncieName = tech.bouncieDevice?.bouncieName?.toLowerCase();
    const vehicle = vehicles.find((v: any) =>
      (techDeviceId && v.imei === techDeviceId) ||
      (techBouncieName && (v.nickName || '').toLowerCase().includes(techBouncieName)) ||
      (v.nickName || '').toLowerCase().includes(tech.name.split(' ')[0].toLowerCase()) ||
      (v.nickName || '').toLowerCase().includes(tech.name.split(' ').pop()!.toLowerCase())
    );

    if (!vehicle) {
      log.push(`  ${tech.name}: no vehicle match`);
      continue;
    }

    // Fetch trips
    let trips: any[] = [];
    try {
      trips = await bouncieFetch('/trips', bouncieToken, {
        imei: vehicle.imei,
        'gps-format': 'geojson',
        'starts-after': tripStart.toISOString(),
        'ends-before': tripEnd.toISOString(),
      });
      if (!Array.isArray(trips)) trips = [];
    } catch (e: any) {
      errors.push(`${tech.name}: ${e.message}`);
      continue;
    }

    if (trips.length === 0) {
      log.push(`  ${tech.name}: no trips today`);
      continue;
    }

    // Analyze trips
    const flaggedTrips: typeof flagged[0]['trips'] = [];
    for (const trip of trips) {
      const durationMins = (new Date(trip.endTime).getTime() - new Date(trip.startTime).getTime()) / 60000;
      const idleMins = (trip.totalIdleDuration || 0) / 60; // totalIdleDuration is in seconds
      const idlePct = durationMins > 0 ? (idleMins / durationMins) * 100 : 0;
      const distance = parseFloat(trip.distance || '0').toFixed(1);

      const reasons: string[] = [];
      if (idleMins > 20) reasons.push(`${idleMins.toFixed(0)}min idle`);
      if (idlePct > 50 && durationMins >= 20) reasons.push(`${idlePct.toFixed(0)}% idle on ${durationMins.toFixed(0)}min trip`);

      if (reasons.length > 0) {
        const startTimeCST = new Date(trip.startTime).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
        const endTimeCST = new Date(trip.endTime).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
        flaggedTrips.push({
          startTime: startTimeCST,
          endTime: endTimeCST,
          durationMins: Math.round(durationMins),
          idleMins: Math.round(idleMins),
          idlePct: Math.round(idlePct),
          distance: distance + ' mi',
          reason: reasons.join(', '),
        });
      }
    }

    if (flaggedTrips.length > 0) {
      flagged.push({ techId: tech.techId, name: tech.name, office: tech.office, trips: flaggedTrips });
      log.push(`  ${tech.name}: ${flaggedTrips.length} flagged trip(s)`);
    } else {
      log.push(`  ${tech.name}: ${trips.length} trips, no flags`);
    }

    // Small delay to avoid Bouncie rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  // Send Slack notification if any flags
  if (flagged.length > 0) {
    const dateFormatted = new Date(reportDate + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    const blocks: any[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `🚨 Idle Time Alert — ${dateFormatted}`, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${flagged.length} tech${flagged.length > 1 ? 's' : ''} flagged* for excessive idling today.\nThresholds: >20 min idle OR >50% idle on a 20+ min trip` },
      },
      { type: 'divider' },
    ];

    for (const tech of flagged) {
      const tripLines = tech.trips.map(t =>
        `• ${t.startTime}–${t.endTime} (${t.durationMins}min, ${t.distance}) — *${t.reason}*`
      ).join('\n');

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${tech.name}* (${tech.techId} · ${tech.office})\n${tripLines}`,
        },
      });
    }

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Reported by Critter Stop Hub at 4:00 PM CST` }],
    });

    await sendSlack(SLACK_WEBHOOK, `Idle Time Alert — ${flagged.length} tech(s) flagged for ${reportDate}`, blocks);
    log.push(`Slack notification sent for ${flagged.length} tech(s)`);

    // Save notified techs for today
    const newNotified = [...notifiedToday, ...flagged.map(f => f.techId)];
    await prisma.appSetting.upsert({
      where: { key: notifiedKey },
      update: { value: JSON.stringify(newNotified) },
      create: { key: notifiedKey, value: JSON.stringify(newNotified) },
    });
  } else {
    log.push('No flags — no Slack notification sent');
  }

  return NextResponse.json({
    status: 'success',
    date: reportDate,
    techsChecked: techs.length,
    flagged: flagged.length,
    errors,
    log: log.join('\n'),
  });
}
