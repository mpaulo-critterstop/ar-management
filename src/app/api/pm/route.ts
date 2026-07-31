import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const pms = await prisma.pM.findMany({ orderBy: [{ office: 'asc' }, { name: 'asc' }] });
    // Attach each PM's currently-active commission method (by name).
    const plans = await prisma.commissionPlan.findMany({ where: { active: true, effectiveTo: null } });
    const planByName = new Map(plans.map(p => [p.pmName, p.method]));
    const withPlan = pms.map(p => ({ ...p, commissionMethod: planByName.get(p.name) ?? null }));
    return NextResponse.json(withPlan);
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
  // Cynthia's variant — two-rate on ABR (no floor), higher first threshold ($15k)
  abr_cynthia: {
    method: 'abr_cynthia',
    tiers: { floor: 0, breaks: [
      { upTo: 15000, rate: 0.05 },
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
    const { id, active, commissionMethod, effectiveFrom } = await req.json();

    // Toggle active (existing behavior)
    let pm = null;
    if (active !== undefined) {
      pm = await prisma.pM.update({ where: { id }, data: { active } });
    } else {
      pm = await prisma.pM.findUnique({ where: { id } });
    }
    if (!pm) return NextResponse.json({ error: 'PM not found' }, { status: 404 });

    // Change commission structure: supersede any current plan (set effectiveTo) and create a new one.
    // Effective-dated so PAST months still compute on the plan that was active then (like Jared New/Old).
    if (commissionMethod && METHOD_PRESETS[commissionMethod]) {
      const preset = METHOD_PRESETS[commissionMethod];
      // New plan effective from the given month (default: start of current month, UTC).
      const eff = effectiveFrom ? new Date(effectiveFrom) : (() => {
        const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
      })();
      // Close the currently-active plan the day before the new one starts.
      const current = await prisma.commissionPlan.findFirst({
        where: { pmName: pm.name, active: true, effectiveTo: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (current) {
        const closeAt = new Date(eff.getTime() - 1);
        await prisma.commissionPlan.update({ where: { id: current.id }, data: { effectiveTo: closeAt, active: false } });
      }
      await prisma.commissionPlan.create({
        data: { pmName: pm.name, method: preset.method, tiers: preset.tiers, effectiveFrom: eff, active: true },
      });
    }

    return NextResponse.json(pm);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
