import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// POST /api/leads/commissions/seed-plans?token=critterstop2026
// One-time: create commission plans for the 9 existing active PMs (they predate the feature).
// Idempotent — skips a PM who already has an active plan.
const PRESETS: Record<string, any> = {
  abr_tiered: { floor: 80000, breaks: [{ upTo: 140000, rate: 0.08 }, { upTo: 180000, rate: 0.10 }, { upTo: null, rate: 0.12 }] },
  abr_adrian: { floor: 0, breaks: [{ upTo: 10000, rate: 0.05 }, { upTo: null, rate: 0.07 }] },
  lead_bucket: { buckets: [{ floor: 700, cap: 1000, rate: 0.08 }, { floor: 1000, cap: 1200, rate: 0.10 }, { floor: 1200, cap: 1400, rate: 0.12 }, { floor: 1400, cap: null, rate: 0.14 }] },
};

// Confirmed active roster + methods (from the FPEM sales-commission sheet).
const SEED: { pmName: string; method: string }[] = [
  { pmName: 'Jordan Price', method: 'abr_tiered' },
  { pmName: 'Jared Brown', method: 'abr_tiered' },        // Jared-New
  { pmName: 'Brant Hauser', method: 'abr_tiered' },
  { pmName: 'Warren Loignon', method: 'abr_tiered' },
  { pmName: 'Travis Doyle', method: 'abr_tiered' },
  { pmName: 'Adrian Valerio', method: 'abr_adrian' },
  { pmName: 'Blake Creswell', method: 'lead_bucket' },
  { pmName: 'Han Bien', method: 'lead_bucket' },
  { pmName: 'Cynthia Barrientos', method: 'lead_bucket' },
];

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || req.headers.get('x-cron-secret');
  if (token !== process.env.CRON_SECRET && token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Effective from Jan 2026 so existing 2026 months compute (adjust later per-PM if a plan changed).
  const effectiveFrom = new Date(Date.UTC(2026, 0, 1));
  const created: string[] = [], skipped: string[] = [];

  for (const s of SEED) {
    const existing = await prisma.commissionPlan.findFirst({ where: { pmName: s.pmName, active: true } });
    if (existing) { skipped.push(s.pmName); continue; }
    await prisma.commissionPlan.create({
      data: { pmName: s.pmName, method: s.method, tiers: PRESETS[s.method], effectiveFrom, active: true },
    });
    created.push(s.pmName);
  }

  return NextResponse.json({ success: true, created, skipped });
}
