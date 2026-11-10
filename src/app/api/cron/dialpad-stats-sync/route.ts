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

  // The sync polls Dialpad for up to ~2 min, which exceeds cron-job.org's 30s timeout (it would mark the job
  // "failed" and deactivate it even though the work completes). So for the scheduled cron we kick the work off
  // in the background and return 200 immediately. Pass &wait=1 for manual/backfill runs to block for the result.
  if (sp.get('wait') === '1' || dry) {
    const result = await runStatsSync(daysAgoStart, daysAgoEnd, dry);
    return NextResponse.json(result, { status: (result as any).error ? 502 : 200 });
  }
  // fire-and-forget: run in the background, respond fast so cron-job.org sees success
  runStatsSync(daysAgoStart, daysAgoEnd, false).catch(e => console.error('[dialpad-stats-sync] bg error', e));
  return NextResponse.json({ ok: true, started: true, note: 'running in background (poll takes ~1-2 min)' });
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
