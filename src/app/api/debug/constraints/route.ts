import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await prisma.$queryRaw<any[]>`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conrelid = 'payroll_weeks'::regclass AND contype='u'`;
  return NextResponse.json({ uniqueConstraints: rows });
}
