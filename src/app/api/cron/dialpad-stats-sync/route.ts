// Dialpad Stats API sync — pulls the authoritative call categorization (missed vs abandoned) that the live
// /api/v2/call endpoint does NOT provide. Flow (confirmed by Dialpad support):
//   1. POST /api/v2/stats  { stat_type: 'calls', export_type: 'records', days_ago_start/end }  -> request_id
//   2. GET  /api/v2/stats/{request_id}  -> poll until status 'complete', returns a download_url
//   3. download the CSV -> parse -> update dialpad_calls.categories + reclassify state from categories
// Then analytics classify missed/abandoned from Dialpad's own 'categories' label (exact match), not duration.
//   GET ?token=critterstop2026[&days=35][&dry=1]
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function getConfig(key: string) {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`SELECT value FROM dialpad_config WHERE key = ${key} LIMIT 1`;
  return row[0]?.value || null;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Derive state from Dialpad's categories tags (authoritative). Returns null if categories is empty/unusable,
// so the caller leaves the existing state (from the live sync's span heuristic) untouched rather than defaulting
// to 'missed' — which was overcounting missed for legs the Stats export doesn't categorize.
function stateFromCategories(categories: string, dateConnected: any): string | null {
  const c = (categories || '').trim().toLowerCase();
  if (dateConnected) return 'answered';
  if (!c) return null; // no category from the export -> don't overwrite the heuristic state
  if (c.includes('abandoned')) return 'abandoned';
  if (c.includes('voicemail')) return 'voicemail';
  if (c.includes('missed') || c.includes('ring_no_answer') || c.includes('unanswered')) return 'missed';
  return null; // unknown tag set -> leave existing state
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = sp.get('dry') === '1';
  const daysAgoStart = parseInt(sp.get('start') || sp.get('days') || '3');
  const daysAgoEnd = parseInt(sp.get('end') || '0');

  // Manual/backfill: run the whole thing synchronously and block for the result.
  if (sp.get('wait') === '1' || dry) {
    const result = await runStatsSync(daysAgoStart, daysAgoEnd, dry);
    return NextResponse.json(result, { status: (result as any).error ? 502 : 200 });
  }

  // SCHEDULED CRON — reliable request/process split (NO fire-and-forget; that was unreliable on serverless —
  // the background task got killed after the fast 200, so categories silently stopped updating).
  // Each call finishes in seconds (within cron-job.org's timeout):
  //   - If no export is pending: REQUEST a new one, store its id, return.
  //   - If an export is pending: POLL once; if ready, DOWNLOAD + apply; else return (next run polls again).
  const PENDING_KEY = 'dialpad_stats_pending';
  const { prisma: _p } = await import('@/lib/prisma');
  const apiKey = await getConfig('dialpad_api_key');
  if (!apiKey) return NextResponse.json({ error: 'no dialpad api key' }, { status: 400 });
  const H = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  const pendingRow = await _p.appSetting.findUnique({ where: { key: PENDING_KEY } }).catch(() => null);
  let pending = pendingRow ? JSON.parse(pendingRow.value) : null;
  // discard a stale pending (older than 20 min) so we don't get stuck
  if (pending && Date.now() - pending.at > 20 * 60 * 1000) pending = null;

  if (!pending) {
    // PHASE 1: request a fresh export
    const reqBody = { stat_type: 'calls', export_type: 'records', days_ago_start: daysAgoStart, days_ago_end: daysAgoEnd };
    const postRes = await fetch('https://dialpad.com/api/v2/stats', { method: 'POST', headers: H, body: JSON.stringify(reqBody) });
    const postJson = await postRes.json().catch(() => null);
    const requestId = postJson?.request_id || postJson?.id;
    if (!requestId) return NextResponse.json({ error: 'no request_id from stats POST', status: postRes.status, body: postJson }, { status: 502 });
    await _p.appSetting.upsert({ where: { key: PENDING_KEY }, create: { key: PENDING_KEY, value: JSON.stringify({ requestId, at: Date.now() }) }, update: { value: JSON.stringify({ requestId, at: Date.now() }) } });
    return NextResponse.json({ ok: true, phase: 'requested', requestId, note: 'export requested; next run will download it' });
  }

  // PHASE 2: poll the pending export once; if ready, download + apply
  const g = await fetch(`https://dialpad.com/api/v2/stats/${pending.requestId}`, { headers: H });
  const gj = await g.json().catch(() => null);
  const downloadUrl = gj?.download_url || gj?.file_url;
  if (gj?.status === 'failed') {
    await _p.appSetting.delete({ where: { key: PENDING_KEY } }).catch(() => {});
    return NextResponse.json({ ok: false, phase: 'failed', note: 'export failed; cleared — next run re-requests' });
  }
  if (!downloadUrl) {
    return NextResponse.json({ ok: true, phase: 'pending', status: gj?.status, note: 'not ready yet; next run will check again' });
  }
  const applied = await applyExport(downloadUrl, apiKey);
  await _p.appSetting.delete({ where: { key: PENDING_KEY } }).catch(() => {});
  return NextResponse.json({ ok: true, phase: 'applied', ...applied });
}

async function runStatsSync(daysAgoStart: number, daysAgoEnd: number, dry: boolean): Promise<any> {
  const apiKey = await getConfig('dialpad_api_key');
  if (!apiKey) return { error: 'no dialpad api key' };
  const H = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' };

  // 1) request the records export for the window
  const reqBody = { stat_type: 'calls', export_type: 'records', days_ago_start: daysAgoStart, days_ago_end: daysAgoEnd };
  const postRes = await fetch('https://dialpad.com/api/v2/stats', { method: 'POST', headers: H, body: JSON.stringify(reqBody) });
  const postJson = await postRes.json().catch(() => null);
  const requestId = postJson?.request_id || postJson?.id;
  if (!requestId) return { error: 'no request_id from stats POST', status: postRes.status, body: postJson };

  // 2) poll for completion
  let downloadUrl: string | null = null; let pollStatus = '';
  for (let i = 0; i < 40; i++) {
    await sleep(3000);
    const g = await fetch(`https://dialpad.com/api/v2/stats/${requestId}`, { headers: H });
    const gj = await g.json().catch(() => null);
    pollStatus = gj?.status || '';
    if (pollStatus === 'complete' || gj?.download_url || gj?.file_url) { downloadUrl = gj?.download_url || gj?.file_url; break; }
    if (pollStatus === 'failed') return { error: 'stats export failed', requestId };
  }
  if (!downloadUrl) return { error: 'stats export not ready (timed out polling)', requestId, lastStatus: pollStatus };

  // 3) download + parse the CSV
  const csvRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  const csv = await csvRes.text();
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { ok: true, note: 'empty export', rows: 0 };
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const idxCallId = header.indexOf('call_id');
  const idxCategories = header.indexOf('categories');
  const idxConnected = header.indexOf('date_connected');
  if (idxCallId < 0 || idxCategories < 0) return { error: 'export missing call_id/categories columns', header };

  // Parse all rows into {callId, categories, newState}. newState null = keep existing state (don't overwrite).
  const parsed: { callId: string; categories: string; newState: string | null }[] = [];
  const sample: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const callId = (cols[idxCallId] || '').trim();
    const categories = (cols[idxCategories] || '').trim();
    const dateConnected = idxConnected >= 0 ? (cols[idxConnected] || '').trim() : '';
    if (!callId) continue;
    const newState = stateFromCategories(categories, dateConnected);
    parsed.push({ callId, categories, newState });
    if (sample.length < 8) sample.push({ callId, categories, newState });
  }

  let updated = 0;
  if (!dry && parsed.length) {
    // Bulk update in chunks: one UPDATE ... FROM (VALUES ...) per chunk instead of a query per row.
    const CHUNK = 500;
    for (let i = 0; i < parsed.length; i += CHUNK) {
      const chunk = parsed.slice(i, i + CHUNK);
      // Build a VALUES list: (id, categories, state)
      const valuesSql = chunk.map((_, k) => `($${k * 3 + 1}, $${k * 3 + 2}, $${k * 3 + 3})`).join(',');
      const params: (string | null)[] = [];
      for (const r of chunk) { params.push(r.callId, r.categories, r.newState); }
      // COALESCE: when newState is NULL (categories empty / unknown), keep the existing state (the live sync's
      // span-based classification) instead of overwriting it.
      const sql = `UPDATE dialpad_calls AS d SET categories = v.categories, state = COALESCE(v.state, d.state)
                   FROM (VALUES ${valuesSql}) AS v(id, categories, state)
                   WHERE d.id = v.id`;
      try {
        const res = await prisma.$executeRawUnsafe(sql, ...params);
        updated += Number(res) || 0;
      } catch (e) { /* skip bad chunk */ }
    }
  }

  return { ok: true, dry, requestId, csvRows: lines.length - 1, parsed: parsed.length, updated, sample };
}

// Minimal CSV line parser that respects double-quoted fields (categories is a quoted comma-joined list).
// Download a ready export CSV and apply the categories -> state. Shared by the sync paths.
async function applyExport(downloadUrl: string, apiKey: string): Promise<any> {
  const csvRes = await fetch(downloadUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
  const csv = await csvRes.text();
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { note: 'empty export', rows: 0, updated: 0 };
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const idxCallId = header.indexOf('call_id');
  const idxCategories = header.indexOf('categories');
  const idxConnected = header.indexOf('date_connected');
  if (idxCallId < 0 || idxCategories < 0) return { error: 'export missing call_id/categories columns', header };
  const parsed: { callId: string; categories: string; newState: string | null }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const callId = (cols[idxCallId] || '').trim();
    const categories = (cols[idxCategories] || '').trim();
    const dateConnected = idxConnected >= 0 ? (cols[idxConnected] || '').trim() : '';
    if (!callId) continue;
    parsed.push({ callId, categories, newState: stateFromCategories(categories, dateConnected) });
  }
  let updated = 0;
  const CHUNK = 500;
  for (let i = 0; i < parsed.length; i += CHUNK) {
    const chunk = parsed.slice(i, i + CHUNK);
    const valuesSql = chunk.map((_, k) => `($${k * 3 + 1}, $${k * 3 + 2}, $${k * 3 + 3})`).join(',');
    const params: (string | null)[] = [];
    for (const r of chunk) params.push(r.callId, r.categories, r.newState);
    const sql = `UPDATE dialpad_calls AS d SET categories = v.categories, state = COALESCE(v.state, d.state)
                 FROM (VALUES ${valuesSql}) AS v(id, categories, state) WHERE d.id = v.id`;
    try { updated += Number(await prisma.$executeRawUnsafe(sql, ...params)) || 0; } catch { /* skip */ }
  }
  return { csvRows: lines.length - 1, parsed: parsed.length, updated };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur);
  return out;
}
