// src/app/api/dialpad/webhook/route.ts
// Receives real-time call events from Dialpad
// Set webhook URL in Dialpad to: https://hub.critterstop.com/api/dialpad/webhook

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function getConfig(key: string): Promise<string | null> {
  const row = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT value FROM dialpad_config WHERE key = ${key} LIMIT 1
  `;
  return row[0]?.value || null;
}

async function analyzeSentiment(text: string): Promise<any> {
  const anthropicKey = await getConfig('anthropic_api_key');
  if (!anthropicKey || !text) return null;

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

Call content: ${text.substring(0, 2000)}`,
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

async function sendSlackAlert(message: string) {
  const slackUrl = await getConfig('slack_webhook');
  if (!slackUrl) return;
  await fetch(slackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // Store last webhook for debugging — full raw payload (truncated) to diagnose event format.
    await prisma.$executeRaw`
      INSERT INTO dialpad_config (key, value, updated_at)
      VALUES ('last_webhook', ${JSON.stringify({ ts: Date.now(), event: payload.event }).substring(0, 5000)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;
    await prisma.$executeRaw`
      INSERT INTO dialpad_config (key, value, updated_at)
      VALUES ('last_webhook_raw', ${JSON.stringify(payload).substring(0, 4900)}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `;

    // Handle AI recap/transcript events — Dialpad sends event_type: 'recap_available'
    if (
      (payload.event_type && payload.event_type.startsWith('recap_')) ||
      payload.event === 'recap' ||
      payload.type === 'recap'
    ) {
      const callId = String(payload.call_id || payload.id || '');
      const summary = payload.summary || payload.recap?.summary || '';
      const transcript = payload.transcript || payload.recap?.transcript || '';

      if (callId && (summary || transcript)) {
        await prisma.$executeRaw`
          UPDATE dialpad_calls SET
            recap_summary = ${summary},
            transcript = ${transcript.substring(0, 5000)}
          WHERE id = ${callId}
        `;

        // Analyze sentiment
        const text = transcript || summary;
        const sentiment = await analyzeSentiment(text);
        if (sentiment) {
          await prisma.$executeRaw`
            UPDATE dialpad_calls SET
              sentiment = ${sentiment.sentiment},
              sentiment_score = ${sentiment.score}
            WHERE id = ${callId}
          `;

          // Slack alert for flagged calls — matching old app format
          if (sentiment.flag_negative || sentiment.flag_positive) {
            const calls = await prisma.$queryRaw<Array<{ external_number: string; target_name: string; date_started: bigint }>>`
              SELECT external_number, target_name, date_started FROM dialpad_calls WHERE id = ${callId} LIMIT 1
            `;
            if (calls[0]) {
              const call = calls[0];
              const time = new Date(Number(call.date_started)).toLocaleString('en-US', { timeZone: 'America/Chicago' });
              const isNegative = sentiment.flag_negative;
              await sendSlackAlert(
                `${isNegative ? '🚨 *Escalation Alert*' : '⭐ *Commendation Alert*'}\n` +
                `*Caller:* ${call.external_number}\n` +
                `*Agent:* ${call.target_name}\n` +
                `*Time:* ${time} CST\n` +
                `*Details:* ${sentiment.reason}\n` +
                `*Review:* https://hub.critterstop.com/calls`
              );
            }
          }
        }
      }
      return NextResponse.json({ success: true });
    }

    // Handle regular call events
    const call = payload;
    if (!call.call_id && !call.id) {
      return NextResponse.json({ success: true, skipped: 'no call_id' });
    }

    const callId = String(call.call_id || call.id);
    const phone = call.external_number || call.contact?.phone || '';
    // Determine call state: answered, voicemail, or missed
    const callState = call.state || '';
    const categories: string = call.categories || '';
    const isVoicemail = callState === 'voicemail' || call.voicemail_url || call.has_voicemail
      || categories.includes('voicemail');
    const state = call.date_connected ? 'answered' : isVoicemail ? 'missed' : 'missed';

    // Check if first-time caller
    let isFirstTime = false;
    if (phone) {
      const existing = await prisma.$queryRaw<Array<{ phone_number: string }>>`
        SELECT phone_number FROM dialpad_known_callers WHERE phone_number = ${phone} LIMIT 1
      `;
      if (!existing[0]) {
        isFirstTime = true;
        await prisma.$executeRaw`
          INSERT INTO dialpad_known_callers (phone_number, first_seen, call_count, updated_at)
          VALUES (${phone}, ${Number(call.date_started)}, 1, NOW())
          ON CONFLICT (phone_number) DO UPDATE SET
            call_count = dialpad_known_callers.call_count + 1,
            updated_at = NOW()
        `;
      } else {
        await prisma.$executeRaw`
          UPDATE dialpad_known_callers SET call_count = call_count + 1, updated_at = NOW()
          WHERE phone_number = ${phone}
        `;
      }
    }

    await prisma.$executeRaw`
      INSERT INTO dialpad_calls (
        id, date_started, date_connected, date_ended, direction, duration, state,
        external_number, internal_number, tracking_number, target_name, target_id,
        target_type, contact_name, entry_point_name, entry_point_call_id,
        operator_call_id, master_call_id, categories, is_first_time
      ) VALUES (
        ${callId},
        ${Number(call.date_started || 0)},
        ${call.date_connected ? Number(call.date_connected) : null},
        ${call.date_ended ? Number(call.date_ended) : null},
        ${call.direction || 'inbound'},
        ${call.duration ? Math.round(Number(call.duration) / 1000) : 0},
        ${state},
        ${phone},
        ${call.internal_number || ''},
        ${call.internal_number || ''},
        ${call.target?.name || call.entry_point_target?.name || ''},
        ${String(call.target?.id || '')},
        ${call.target?.type || ''},
        ${call.contact?.name || ''},
        ${call.entry_point_target?.name || ''},
        ${String(call.entry_point_call_id || '')},
        ${String(call.operator_call_id || '')},
        ${String(call.master_call_id || '')},
        ${categories},
        ${isFirstTime}
      )
      ON CONFLICT (id) DO UPDATE SET
        date_connected = EXCLUDED.date_connected,
        date_ended = EXCLUDED.date_ended,
        duration = EXCLUDED.duration,
        state = EXCLUDED.state,
        categories = EXCLUDED.categories,
        is_first_time = EXCLUDED.is_first_time
    `;

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Dialpad webhook error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Dialpad webhook active' });
}
