// LSA leads for the tracker UI (GET) + follow-up status/note update (PATCH).
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deriveLsaStage } from '@/lib/lsaStage';

export const dynamic = 'force-dynamic';

const STAGES = ['New', 'Awaiting Customer', 'Customer Replied', 'Need Follow-up', 'Booked', 'Lost'];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status');
  const leadType = sp.get('leadType');
  const location = sp.get('location');

  const where: any = {};
  if (status && status !== 'All') where.status = status;
  if (leadType && leadType !== 'All') where.leadType = leadType;
  if (location && location !== 'All') where.location = location;

  const leads = await prisma.lsaLead.findMany({
    where,
    orderBy: [{ creationDateTime: 'desc' }],
    take: 1000,
  });

  // Counts per stage (message-pipeline leads only; call leads excluded), scoped to the selected location.
  const countWhere: any = {};
  if (location && location !== 'All') countWhere.location = location;
  const all = await prisma.lsaLead.findMany({ where: countWhere, select: { status: true, leadType: true, staleFlagged: true } });
  // Distinct locations for the selector.
  const locRows = await prisma.lsaLead.findMany({ select: { location: true }, distinct: ['location'], orderBy: { location: 'asc' } });
  const locations = locRows.map(r => r.location);
  const byStage: Record<string, number> = {};
  for (const s of STAGES) byStage[s] = 0;
  let messageOpen = 0, followupNeeded = 0;
  for (const l of all) {
    if (l.leadType === 'PHONE_CALL') continue; // exclude call leads from pipeline counts
    if (byStage[l.status] !== undefined) byStage[l.status] = (byStage[l.status] || 0) + 1;
    if (l.status === 'Need Follow-up') followupNeeded++;
    if (l.leadType === 'MESSAGE' && !['Booked', 'Lost'].includes(l.status)) messageOpen++;
  }

  return NextResponse.json({ leads, stages: STAGES, byStage, messageOpen, followupNeeded, total: all.length, locations });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { leadId, action, tag, followupNote } = body;
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 });

  const lead = await prisma.lsaLead.findUnique({ where: { leadId } });
  if (!lead) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const data: any = {};

  if (action === 'tag') {
    // Manual Booked/Lost tag — overrides automation.
    if (tag !== 'Booked' && tag !== 'Lost') return NextResponse.json({ error: 'tag must be Booked or Lost' }, { status: 400 });
    data.status = tag;
    data.manualOverride = true;
    data.staleFlagged = false; // no longer needs follow-up
  } else if (action === 'untag') {
    // Release back to automatic: clear override and re-derive the stage from stored activity.
    const derived = deriveLsaStage({
      lastParticipant: (lead.lastParticipant as any) ?? null,
      lastActivityAt: lead.lastActivityAt,
      creationDateTime: lead.creationDateTime,
    });
    data.status = derived;
    data.manualOverride = false;
    data.staleFlagged = false;
  }

  if (followupNote !== undefined) data.followupNote = followupNote;

  const updated = await prisma.lsaLead.update({ where: { leadId }, data });
  return NextResponse.json({ ok: true, lead: updated });
}
