import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const testId = '5299253183422464';
  let found: any = null;
  try { found = await prisma.$queryRaw`SELECT id::text, state, categories FROM dialpad_calls WHERE id = ${BigInt(testId)}`; } catch(e){ found = {err:String(e)}; }
  const sampleOurs = await prisma.$queryRaw<any[]>`SELECT id::text AS id, state FROM dialpad_calls ORDER BY date_started DESC LIMIT 5`;
  const total = await prisma.$queryRaw<any[]>`SELECT COUNT(*)::text AS n FROM dialpad_calls`;
  return NextResponse.json({ testIdFound: found, sampleOurIds: sampleOurs, totalRows: total[0].n });
}
