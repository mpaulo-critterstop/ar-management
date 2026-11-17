import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // find by invoice 281517 or cardholder Ashley Long
  const rows = await prisma.staxPayment.findMany({
    where: { OR: [{ frInvoiceNumber: '281517' }, { cardHolderName: { contains: 'Long', mode: 'insensitive' } }] },
    orderBy: { createdAt: 'desc' }, take: 5,
  });
  return NextResponse.json({ rows });
}
