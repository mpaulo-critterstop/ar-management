import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File;
  const weekEnd = formData.get('weekEnd') as string;

  if (!file || !weekEnd) {
    return NextResponse.json({ error: 'file and weekEnd required' }, { status: 400 });
  }

  const text = await file.text();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return NextResponse.json({ error: 'Empty CSV' }, { status: 400 });

  // Parse headers — remove BOM if present
  const headers = lines[0].replace(/^\uFEFF/, '').split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const idxTech = headers.indexOf('Route Assigned To');
  const idxProd = headers.indexOf('Production Value');
  const idxSched = headers.indexOf('Total Scheduled Services');
  const idxComp = headers.indexOf('Completed Services');

  if (idxTech === -1 || idxProd === -1) {
    return NextResponse.json({ error: `Missing columns. Found: ${headers.join(', ')}` }, { status: 400 });
  }

  // Aggregate by tech name
  const techStats = new Map<string, { production: number; scheduled: number; completed: number }>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    const tech = cols[idxTech]?.trim();
    if (!tech) continue;
    const prod = parseFloat(cols[idxProd]?.replace(/,/g, '') || '0') || 0;
    const sched = parseInt(cols[idxSched] || '0') || 0;
    const comp = parseInt(cols[idxComp] || '0') || 0;

    if (!techStats.has(tech)) techStats.set(tech, { production: 0, scheduled: 0, completed: 0 });
    const s = techStats.get(tech)!;
    s.production += prod;
    s.scheduled += sched;
    s.completed += comp;
  }

  // Match tech names to technicians in DB
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, techId: true, name: true },
  });

  const weekEndDate = new Date(weekEnd + 'T00:00:00.000Z');
  const PROD_STANDARD_PER_DAY = 5676.92;

  let updated = 0;
  const notMatched: string[] = [];
  const log: string[] = [];

  for (const [techName, stats] of techStats) {
    // Find tech by name (case-insensitive, handle slight variations)
    const tech = techs.find((t: { id: string; techId: string; name: string }) =>
      t.name.toLowerCase() === techName.toLowerCase() ||
      t.name.toLowerCase().replace(/\s+/g, ' ') === techName.toLowerCase().replace(/\s+/g, ' ')
    );

    if (!tech) { notMatched.push(techName); continue; }

    const tw = await prisma.techWeek.findFirst({
      where: { techId: tech.techId, weekEnd: weekEndDate },
    });

    if (!tw) { log.push(`${tech.techId} ${techName}: no TechWeek record`); continue; }

    // Revenue efficiency: production / (5 days × standard per day)
    const revenueEff = stats.production > 0
      ? Math.min(stats.production / (PROD_STANDARD_PER_DAY * 5), 1.1)
      : null;

    const completionPct = stats.scheduled > 0
      ? stats.completed / stats.scheduled
      : null;

    await prisma.techWeek.update({
      where: { id: tw.id },
      data: {
        productionValue: stats.production,
        revenueEfficiency: revenueEff,
        completionPct: completionPct ?? tw.completionPct,
      },
    });

    log.push(`${tech.techId} ${techName}: prod=$${stats.production.toFixed(0)}, revEff=${revenueEff?.toFixed(2) ?? '—'}, completion=${completionPct ? (completionPct*100).toFixed(0)+'%' : '—'}`);
    updated++;
  }

  // Recalculate PMP scores for updated techs
  // (trigger score recalc by updating totalScore)
  const updatedTechs = await prisma.techWeek.findMany({
    where: { weekEnd: weekEndDate, team: 'PMP' },
    include: { technician: true },
  });

  for (const tw of updatedTechs) {
    if (tw.revenueEfficiency === null) continue;
    const revEff = tw.revenueEfficiency;
    const reservice = tw.reseviceRate ?? 0;
    const completion = tw.completionPct ?? 0;
    const driving = tw.drivingScore ?? 0;
    const reliability = tw.reliabilityScore ?? 0;

    const pmpScore = Math.min(
      revEff        * 0.35 +
      (1 - reservice) * 0.20 +
      completion    * 0.20 +
      driving       * 0.10 +
      reliability   * 0.15,
      1.1
    );

    await prisma.techWeek.update({
      where: { id: tw.id },
      data: { pmpScore, totalScore: pmpScore },
    });
  }

  return NextResponse.json({
    ok: true,
    updated,
    notMatched,
    log,
  });
}
