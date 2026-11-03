// Clear the Stax Payments module tables of test/sandbox data for a clean go-live slate.
// Tables: staxPayment (Payment Report tab) + paymentLinkRequest where processor='stax' (Payment Links tab).
//   GET ?token=critterstop2026            -> DRY RUN (counts only, deletes nothing)
//   GET ?token=critterstop2026&confirm=1  -> actually delete
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('token') !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const confirm = req.nextUrl.searchParams.get('confirm') === '1';

  const staxCount = await prisma.staxPayment.count().catch(() => 0);
  const linkCount = await prisma.paymentLinkRequest.count({ where: { processor: 'stax' } as any }).catch(() => 0);

  if (!confirm) {
    return NextResponse.json({
      dryRun: true,
      wouldDelete: { staxPayment: staxCount, paymentLinkRequest_stax: linkCount },
      note: 'Add &confirm=1 to actually delete. This wipes the Stax Payment Report + Payment Links tabs.',
    });
  }

  const delStax = await prisma.staxPayment.deleteMany({}).catch((e) => ({ count: 0, error: String(e) }));
  const delLinks = await prisma.paymentLinkRequest.deleteMany({ where: { processor: 'stax' } as any }).catch((e) => ({ count: 0, error: String(e) }));

  return NextResponse.json({
    ok: true,
    deleted: { staxPayment: (delStax as any).count, paymentLinkRequest_stax: (delLinks as any).count },
  });
}
