import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const pms = await prisma.pM.findMany({ orderBy: [{ office: 'asc' }, { name: 'asc' }] });
    return NextResponse.json(pms);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Standard tier presets per method (from the FPEM sales-commission sheet).
const METHOD_PRESETS: Record<string, { method: string; tiers: any }> = {
  // Method 1 — marginal tiers on Adjusted Booked Revenue, $80k floor
  abr_tiered: {
    method: 'abr_tiered',
    tiers: { floor: 80000, breaks: [
      { upTo: 140000, rate: 0.08 },
      { upTo: 180000, rate: 0.10 },
      { upTo: null, rate: 0.12 },
    ] },
  },
  // Adrian's variant — two-rate on ABR (no floor)
  abr_adrian: {
    method: 'abr_adrian',
    tiers: { floor: 0, breaks: [
      { upTo: 10000, rate: 0.05 },
      { upTo: null, rate: 0.07 },
    ] },
  },
  // Method 2 — lead-bucket by revenue-per-lead
  lead_bucket: {
    method: 'lead_bucket',
    tiers: { buckets: [
      { floor: 700, cap: 1000, rate: 0.08 },
      { floor: 1000, cap: 1200, rate: 0.10 },
      { floor: 1200, cap: 1400, rate: 0.12 },
      { floor: 1400, cap: null, rate: 0.14 },
    ] },
  },
};

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { name, office, commissionMethod } = await req.json();
    const pm = await prisma.pM.create({ data: { name, office } });

    // If a commission structure was chosen, create the PM's plan (effective from the start of this month).
    if (commissionMethod && METHOD_PRESETS[commissionMethod]) {
      const preset = METHOD_PRESETS[commissionMethod];
      const now = new Date();
      const effectiveFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      // Guard against a duplicate active plan for this PM name.
      const existing = await prisma.commissionPlan.findFirst({ where: { pmName: name, active: true } });
      if (!existing) {
        await prisma.commissionPlan.create({
          data: { pmName: name, method: preset.method, tiers: preset.tiers, effectiveFrom, active: true },
        });
      }
    }

    return NextResponse.json(pm);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id, active } = await req.json();
    const pm = await prisma.pM.update({ where: { id }, data: { active } });
    return NextResponse.json(pm);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
