// src/app/api/dialpad/sync/route.ts
// Cron job endpoint — fetches latest calls from Dialpad API and upserts into dialpad_calls
// Also runs sentiment analysis on recently answered calls missing it
// Hit every 2 minutes from cron-job.org

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function getConfig(key: string): Promise<string | null> {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT value FROM dialpad_config WHERE key = ${key} LIMIT 1
  `;
  return row[0]?.value || null;
}

async function setConfig(key: string, value: string) {
  await prisma.$executeRaw`
    INSERT INTO dialpad_config (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
  `;
}

async function analyzeSentiment(transcript: string, anthropicKey: string): Promise<any> {
  if (!transcript || !anthropicKey) return null;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Analyze this pest control customer service call. Respond ONLY with a JSON object, no other text:
{"sentiment": "positive|neutral|negative", "score": 0.0-1.0, "reason": "one sentence explanation", "flag_negative": true|false, "flag_positive": true|false}

flag_negative = true ONLY if: customer is extremely angry/hostile, explicitly threatening to cancel service, demanding refund, threatening legal action, or situation clearly requires manager intervention.
flag_positive = true ONLY if: customer specifically praises an agent by name, gives exceptional compliment worth sharing with the team, or explicitly says they will refer others.

Call content: ${transcript.substring(0, 2000)}`,
        }],
      }),
    });
    const data = await resp.json();
    const txt = data.content?.[0]?.text || '{}';
    return JSON.parse(txt.replace(/```json|```/g, '').trim());
  } catch {
    return null;
  }
}

async function sendSlackAlert(message: string, slackUrl: string) {
  await fetch(slackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });
}

export async function GET(req: NextRequest) {
  // Allow cron-job.org bypass header OR internal calls
  const bypassHeader = req.headers.get('x-vercel-protection-bypass');
  const authHeader = req.headers.get('authorization');
  const { searchParams } = new URL(req.url);
  const tokenParam = searchParams.get('token');
  const cronSecret = process.env.CRON_SECRET || 'critterstop2026';
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || cronSecret;

  if (
    bypassHeader !== bypassSecret &&
    authHeader !== `Bearer ${cronSecret}` &&
    tokenParam !== cronSecret
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isBackfill = searchParams.get('backfill') === 'today';

  const results = { fetched: 0, upserted: 0, sentiment_processed: 0, backfill: isBackfill, errors: [] as string[] };

  try {
    const apiKey = await getConfig('dialpad_api_key');
    if (!apiKey) {
      return NextResponse.json({ error: 'dialpad_api_key not configured' }, { status: 500 });
    }

    // --- STEP 1: Fetch calls from Dialpad API ---
    let allCalls: any[] = [];

    if (isBackfill) {
      // Start of today in CST
      const nowCST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
      const midnightCST = new Date(nowCST);
      midnightCST.setHours(0, 0, 0, 0);
      const startedAfterTs = Math.floor(midnightCST.getTime() / 1000);

      await setConfig('last_sync_cursor', '');

      let pageCursor: string | null = null;
      let pages = 0;
      do {
        const paramObj: Record<string, string> = {
          limit: '100',
          started_after: String(startedAfterTs),
        };
        if (pageCursor) paramObj.cursor = pageCursor;
        const params: URLSearchParams = new URLSearchParams(paramObj);

        const resp: Response = await fetch(`https://dialpad.com/api/v2/call?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        });

        if (!resp.ok) {
          results.errors.push(`Dialpad API page ${pages}: ${resp.status}`);
          break;
        }

        const data: any = await resp.json();
        allCalls = allCalls.concat(data.items || []);
        pageCursor = data.cursor || null;
        pages++;
        if (pages >= 20) break;
      } while (pageCursor);

    } else {
      // Normal mode: fetch latest 50 using stored cursor
      const cursor = await getConfig('last_sync_cursor');
      const startedAfter = Date.now() - (10 * 60 * 1000);

      const params = new URLSearchParams({
        limit: '50',
        ...(cursor ? { cursor } : { started_after: String(Math.floor(startedAfter / 1000)) }),
      });

      const dialpadResp = await fetch(`https://dialpad.com/api/v2/call?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      });

      if (dialpadResp.ok) {
        const data = await dialpadResp.json();
        allCalls = data.items || [];
        if (data.cursor) await setConfig('last_sync_cursor', data.cursor);
      } else {
        const errText = await dialpadResp.text();
        results.errors.push(`Dialpad API ${dialpadResp.status}: ${errText.substring(0, 200)}`);
      }
    }

    results.fetched = allCalls.length;

    // Upsert each call into dialpad_calls
    for (const call of allCalls) {
        try {
          const id = BigInt(call.call_id || call.id);
          const dateStarted = call.date_started ? BigInt(call.date_started) : null;
          const dateConnected = call.date_connected ? BigInt(call.date_connected) : null;
          const dateEnded = call.date_ended ? BigInt(call.date_ended) : null;
          const duration = call.duration ? Number(call.duration) : null;

          // Determine state
          let state = 'missed';
          if (dateConnected) state = 'answered';
          else if (call.voicemail_share_link) state = 'voicemail';

          await prisma.$executeRaw`
            INSERT INTO dialpad_calls (
              id, date_started, date_connected, date_ended,
              direction, duration, state,
              external_number, internal_number, tracking_number,
              target_name, target_id, target_type,
              contact_name, entry_point_name,
              entry_point_call_id, operator_call_id, master_call_id,
              categories, is_first_time, created_at
            ) VALUES (
              ${id},
              ${dateStarted}, ${dateConnected}, ${dateEnded},
              ${call.direction || 'inbound'},
              ${duration},
              ${state},
              ${call.external_number || ''},
              ${call.internal_number || ''},
              ${call.internal_number || ''},
              ${call.target?.name || ''},
              ${call.target?.id ? String(call.target.id) : ''},
              ${call.target?.type || ''},
              ${call.contact?.name || ''},
              ${call.entry_point_target?.name || ''},
              ${call.entry_point_call_id ? String(call.entry_point_call_id) : ''},
              ${call.operator_call_id ? String(call.operator_call_id) : ''},
              ${call.master_call_id ? String(call.master_call_id) : ''},
              ${''},
              ${false},
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              date_connected = EXCLUDED.date_connected,
              date_ended = EXCLUDED.date_ended,
              duration = EXCLUDED.duration,
              state = EXCLUDED.state
          `;
          results.upserted++;
        } catch (e: any) {
          results.errors.push(`upsert ${call.call_id}: ${e.message}`);
        }
      }

    await setConfig('last_sync_at', new Date().toISOString());

    // --- STEP 2: Sentiment analysis on recently answered calls ---
    const anthropicKey = await getConfig('anthropic_api_key');
    const slackUrl = await getConfig('slack_webhook');

    await setConfig('sync_debug', `anthropic_key: ${anthropicKey ? 'found' : 'missing'}`);

    if (anthropicKey) {
      // Find answered user-type legs from last 2 hours without sentiment
      const callsNeedingSentiment = await prisma.$queryRaw<Array<{
        id: bigint;
        external_number: string;
        target_name: string;
        date_started: bigint;
        entry_point_call_id: string;
      }>>`
        SELECT id, external_number, target_name, date_started, entry_point_call_id
        FROM dialpad_calls
        WHERE target_type = 'user'
          AND direction = 'inbound'
          AND date_connected IS NOT NULL
          AND sentiment IS NULL
          AND date_started >= ${BigInt(Date.now() - 7200000)}
        LIMIT 5
      `;

      await setConfig('sync_debug2', `calls_needing_sentiment: ${callsNeedingSentiment.length}`);

      for (const call of callsNeedingSentiment) {
        try {
          const callId = String(call.id);
          await setConfig('sync_debug3', `fetching transcript for: ${callId}`);

          const transcriptResp = await fetch(
            `https://dialpad.com/api/v2/transcripts/${callId}?apikey=${apiKey}`,
            { headers: { 'Accept': 'application/json' } }
          );

          const transcriptRaw = await transcriptResp.text();
          await setConfig('last_transcript_debug', `status: ${transcriptResp.status}, body: ${transcriptRaw.substring(0, 500)}`);

          if (transcriptResp.status !== 200) continue;

          const transcriptData = JSON.parse(transcriptRaw);
          const lines = (transcriptData.lines || []).filter((l: any) => l.type === 'transcript');
          if (!lines.length) continue;

          const transcript = lines.map((l: any) => `${l.name}: ${l.content}`).join('\n');

          // Save transcript
          await prisma.$executeRaw`
            UPDATE dialpad_calls SET transcript = ${transcript.substring(0, 5000)} WHERE id = ${call.id}
          `;

          const sentiment = await analyzeSentiment(transcript, anthropicKey);
          if (!sentiment) continue;

          await setConfig('sync_debug4', `sentiment: ${sentiment.sentiment}, call: ${callId}`);

          // Save sentiment
          await prisma.$executeRaw`
            UPDATE dialpad_calls SET
              sentiment = ${sentiment.sentiment},
              sentiment_score = ${sentiment.score || null},
              recap_summary = ${sentiment.reason || null}
            WHERE id = ${call.id}
          `;

          results.sentiment_processed++;

          // Send Slack alert if flagged
          if (slackUrl && (sentiment.flag_negative || sentiment.flag_positive)) {
            const timeStr = new Date(Number(call.date_started)).toLocaleString('en-US', {
              timeZone: 'America/Chicago',
            });
            const agentName = call.target_name || 'Unknown Agent';
            const callerNum = call.external_number || 'Unknown';

            const message = sentiment.flag_negative
              ? `🚨 *Escalation Alert*\n*Caller:* ${callerNum}\n*Agent:* ${agentName}\n*Time:* ${timeStr} CST\n*Details:* ${sentiment.reason}\n*Review:* https://hub.critterstop.com/calls`
              : `⭐ *Commendation Alert*\n*Caller:* ${callerNum}\n*Agent:* ${agentName}\n*Time:* ${timeStr} CST\n*Details:* ${sentiment.reason}\n*Review:* https://hub.critterstop.com/calls`;

            await sendSlackAlert(message, slackUrl);
          }
        } catch (e: any) {
          results.errors.push(`sentiment ${String(call.id)}: ${e.message}`);
          await setConfig('sync_error', e.message);
        }
      }
    }

    return NextResponse.json({ ok: true, ...results });
  } catch (e: any) {
    await setConfig('sync_error', e.message).catch(() => {});
    return NextResponse.json({ error: e.message, ...results }, { status: 500 });
  }
}
