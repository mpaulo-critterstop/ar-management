import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

const OFFICES = {
  DFW: { key: process.env.FIELDROUTES_KEY_DFW!, token: process.env.FIELDROUTES_TOKEN_DFW! },
  ATX: { key: process.env.FIELDROUTES_KEY_ATX!, token: process.env.FIELDROUTES_TOKEN_ATX! },
  OKC: { key: process.env.FIELDROUTES_KEY_OKC!, token: process.env.FIELDROUTES_TOKEN_OKC! },
  CStat: { key: process.env.FIELDROUTES_KEY_CSTAT!, token: process.env.FIELDROUTES_TOKEN_CSTAT! },
};

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

async function frFetch(endpoint: string, params: string, key: string, token: string) {
  const url = `${FR_BASE}/${endpoint}?${params}&authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAccessModule(session.user as any, 'dispatch')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const officeParam = searchParams.get('office');
    const statusFilter = searchParams.get('status') || 'ACTIVE';
    const stageFilter = searchParams.get('stage');
    const office = (session.user as any)?.office;
    const officeFilter = (officeParam && officeParam !== 'ALL') ? officeParam : (office !== 'ALL' && office !== 'ADMIN' ? office : null);

    const where: any = {
      ...(officeFilter && { office: { equals: officeFilter, mode: 'insensitive' } }),
      ...(statusFilter !== 'ALL' && stageFilter !== 'closed_this_month' && { status: statusFilter }),
    };

    // Stage filters
    if (stageFilter === 'exclusion_pending') {
      where.exclusionDone = false;
   } else if (stageFilter === 'trap_checks') {
      where.exclusionDone = true;
      where.hasTrapping = true;
      where.trapsDone = false;
      where.closedOut = false;
    } else if (stageFilter === 'far_pending') {
      where.exclusionDone = true;
      where.hasFAR = true;
      where.farDone = false;
      where.trapsDone = true;
      where.closedOut = false;
    } else if (stageFilter === 'needs_attention') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      where.OR = [
        { updatedAt: { lt: sevenDaysAgo }, closedOut: false },
        { hasTrapping: true, trapCheckCount: { gte: 3 }, closedOut: false },
      ];
    } else if (stageFilter === 'closed_this_month') {
      where.status = 'CLOSED';
      where.closedOutDate = { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) };
    }

    const jobs = await prisma.dispatchJob.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true, serviceAddr: true, externalId: true } },
        invoice: { select: { id: true, externalId: true, amount: true, date: true } },
      },
      // Sort by sold date (invoice date), newest first. Jobs without an invoice sort LAST
      // (NULLS LAST) so an unlinked job never floats to the top of the board.
      orderBy: [
        { invoice: { date: { sort: 'desc', nulls: 'last' } } },
        { createdAt: 'desc' },
      ],
    });

    // Calculate KPIs
    const allActive = await prisma.dispatchJob.findMany({
      where: { ...(officeFilter && { office: { equals: officeFilter, mode: 'insensitive' } }), status: 'ACTIVE' },
      select: { exclusionDone: true, hasTrapping: true, hasFAR: true, farDone: true, closedOut: true, trapCheckCount: true, updatedAt: true, createdAt: true, trapsDone: true },
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const kpis = {
  total: allActive.length,
  exclusionPending: allActive.filter(j => !j.exclusionDone).length,
  trapChecks: allActive.filter(j => j.hasTrapping && !j.trapsDone).length,
  farPending: allActive.filter(j => j.exclusionDone && (!j.hasTrapping || j.trapsDone) && j.hasFAR && !j.farDone && !j.closedOut).length,
  needsAttention: allActive.filter(j =>
    (!j.closedOut && j.updatedAt < sevenDaysAgo) ||
    (j.hasTrapping && j.trapCheckCount >= 3 && !j.trapsDone)
  ).length,
  closedThisMonth: await prisma.dispatchJob.count({
    where: {
      ...(officeFilter && { office: { equals: officeFilter, mode: 'insensitive' } }),
      status: 'CLOSED',
      closedOutDate: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    },
  }),
};

    return NextResponse.json({ jobs, kpis });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAccessModule(session.user as any, 'dispatch')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const { id, notes, stageEdit } = body;

    if (!id) return NextResponse.json({ error: 'Job ID required' }, { status: 400 });

    const data: any = {};
    if (notes !== undefined) data.notes = notes;

    if (stageEdit) {
      if (stageEdit.exclusionDone !== undefined) data.exclusionDone = stageEdit.exclusionDone;
      if (stageEdit.exclusionDate !== undefined) data.exclusionDate = stageEdit.exclusionDate ? new Date(stageEdit.exclusionDate) : null;
      if (stageEdit.trapsDone !== undefined) data.trapsDone = stageEdit.trapsDone;
      if (stageEdit.trapCheckCount !== undefined) data.trapCheckCount = stageEdit.trapCheckCount;
      if (stageEdit.lastTrapCheck !== undefined) data.lastTrapCheck = stageEdit.lastTrapCheck ? new Date(stageEdit.lastTrapCheck) : null;
      if (stageEdit.farDone !== undefined) data.farDone = stageEdit.farDone;
      if (stageEdit.farDate !== undefined) data.farDate = stageEdit.farDate ? new Date(stageEdit.farDate) : null;
      if (stageEdit.closedOut !== undefined) data.closedOut = stageEdit.closedOut;
      if (stageEdit.closedOutDate !== undefined) data.closedOutDate = stageEdit.closedOutDate ? new Date(stageEdit.closedOutDate) : null;
      
      // Auto update status
      if (stageEdit.closedOut === true) data.status = 'CLOSED';
      if (stageEdit.closedOut === false) data.status = 'ACTIVE';
    }

    const job = await prisma.dispatchJob.update({
      where: { id },
      data,
    });

    return NextResponse.json(job);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
