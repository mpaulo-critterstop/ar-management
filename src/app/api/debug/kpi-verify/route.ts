import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
const TERM: Record<string,string> = {'jacob fenton':'ATX','roderick stanford':'CStat','justin rogers':'CStat','jonathan ferreira':'DFW','chisam reiter':'DFW','david liles':'DFW',"ryan o'connor":'DFW','joey lowe':'DFW','kenny barrett':'DFW'};
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = req.nextUrl.searchParams.get('key') || '2024-06';
  const company = await prisma.kpiHistory.findFirst({ where: { period: 'monthly', scope: 'company', periodKey: key } });
  const pmRows = await prisma.kpiHistory.findMany({ where: { period: 'monthly', scope: { not: 'company' }, periodKey: key } });
  const pms = await prisma.pM.findMany();
  const off: Record<string,string> = {}; for (const p of pms) off[p.name.toLowerCase()]=p.office;
  for (const [n,o] of Object.entries(TERM)) if (!off[n]) off[n]=o;
  const byOffice: Record<string, number> = {}; let pmSum=0; const unmapped: string[]=[];
  for (const h of pmRows) { pmSum+=h.booked; const o=off[h.scope.toLowerCase()]; if (!o) { unmapped.push(h.scope); continue; } byOffice[o]=(byOffice[o]||0)+h.booked; }
  return NextResponse.json({ month:key, companyBooked:company?.booked??null, perPmSum:Math.round(pmSum), byOffice:Object.fromEntries(Object.entries(byOffice).map(([k,v])=>[k,Math.round(v)])), sumOfOffices:Math.round(Object.values(byOffice).reduce((a,b)=>a+b,0)), stillUnmapped:unmapped });
}
