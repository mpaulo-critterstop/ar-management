export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get('token') !== 'critterstop2026' && searchParams.get('token') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const office  = searchParams.get('office') || 'CStat';
  const weekEnd = searchParams.get('weekEnd') || '';
  const base    = process.env.NEXTAUTH_URL || 'https://hub.critterstop.com';
  const token   = 'critterstop2026';

  const params = new URLSearchParams({ token, office, ...(weekEnd && { weekEnd }) });
  const log: string[] = [`Starting full field-performance sync for ${office}...`];
  const results: any = {};

  // Step 1 — Week (production value)
  try {
    log.push('\n--- Step 1: Week production ---');
    const r1 = await fetch(`${base}/api/field-performance/week?${params}`, {
      signal: AbortSignal.timeout(280000),
    });
    const d1 = await r1.json();
    results.week = { status: d1.status, routesProcessed: d1.routesProcessed, techsUpserted: d1.techsUpserted };
    log.push(`Status: ${d1.status} | Routes: ${d1.routesProcessed} | Techs: ${d1.techsUpserted}`);
    if (d1.status !== 'success') throw new Error(`Week step failed: ${d1.error || 'unknown'}`);
  } catch (e: any) {
    log.push(`Step 1 error: ${e.message}`);
    return NextResponse.json({ status: 'error', step: 'week', error: e.message, log: log.join('\n'), results }, { status: 500 });
  }

  // Step 2 — 30-day completion rate
  try {
    log.push('\n--- Step 2: 30-day completion ---');
    const r2 = await fetch(`${base}/api/field-performance/thirtyDay?${params}`, {
      signal: AbortSignal.timeout(280000),
    });
    const d2 = await r2.json();
    results.thirtyDay = { status: d2.status, routesProcessed: d2.routesProcessed, techsUpserted: d2.techsUpserted };
    log.push(`Status: ${d2.status} | Routes: ${d2.routesProcessed} | Techs: ${d2.techsUpserted}`);
    if (d2.status !== 'success') throw new Error(`ThirtyDay step failed: ${d2.error || 'unknown'}`);
  } catch (e: any) {
    log.push(`Step 2 error: ${e.message}`);
    return NextResponse.json({ status: 'error', step: 'thirtyDay', error: e.message, log: log.join('\n'), results }, { status: 500 });
  }

  // Step 3 — Reservice + revenue efficiency
  try {
    log.push('\n--- Step 3: Reservice + revenue efficiency ---');
    const r3 = await fetch(`${base}/api/field-performance/run?${params}`, {
      signal: AbortSignal.timeout(280000),
    });
    const d3 = await r3.json();
    results.run = { status: d3.status, techsUpserted: d3.techsUpserted };
    log.push(`Status: ${d3.status} | Techs: ${d3.techsUpserted}`);
    if (d3.status !== 'success') throw new Error(`Run step failed: ${d3.error || 'unknown'}`);
  } catch (e: any) {
    log.push(`Step 3 error: ${e.message}`);
    return NextResponse.json({ status: 'error', step: 'run', error: e.message, log: log.join('\n'), results }, { status: 500 });
  }

  log.push('\n✅ All 3 steps completed successfully!');

  return NextResponse.json({
    status: 'success',
    office,
    weekEnd: weekEnd || 'auto',
    results,
    log: log.join('\n'),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
