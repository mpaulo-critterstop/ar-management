import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const OFFICE_KEYS: Record<string, { key: string; token: string }> = {
  DFW: {
    key: process.env.FIELDROUTES_KEY_DFW!,
    token: process.env.FIELDROUTES_TOKEN_DFW!,
  },
  ATX: {
    key: process.env.FIELDROUTES_KEY_ATX!,
    token: process.env.FIELDROUTES_TOKEN_ATX!,
  },
  OKC: {
    key: process.env.FIELDROUTES_KEY_OKC!,
    token: process.env.FIELDROUTES_TOKEN_OKC!,
  },
  CStat: {
    key: process.env.FIELDROUTES_KEY_CSTAT!,
    token: process.env.FIELDROUTES_TOKEN_CSTAT!,
  },
};

const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

async function fetchPaymentIDs(key: string, token: string): Promise<number[]> {
  const url = `${FR_BASE}/payment/search?authenticationKey=${key}&authenticationToken=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.success) throw new Error('FieldRoutes payment search failed');
  return data.paymentIDs || [];
}

async function fetchPayments(key: string, token: string, ids: number[]): Promise<any[]> {
  const BATCH = 100;
  const results: any[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH).join(',');
    const url = `${FR_BASE}/payment/get?paymentIDs=${batch}&authenticationKey=${key}&authenticationToken=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success && data.payments) {
      results.push(...data.payments);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { office } = await req.json();
  if (!office || !OFFICE_KEYS[office]) {
    return NextResponse.json({ error: 'Invalid office. Must be DFW, ATX, OKC, or CStat' }, { status: 400 });
  }

  const { key, token } = OFFICE_KEYS[office];

  if (!key || !token) {
    return NextResponse.json({ error: `Missing API credentials for ${office}` }, { status: 500 });
  }

  const startedAt = new Date();
  let paymentsCreated = 0;
  let invoicesUpdated = 0;
  let errorCount = 0;
  const errors: string[] = [];

  try {
    const allPaymentIDs = await fetchPaymentIDs(key, token);

    const existingPayments = await prisma.payment.findMany({
      where: { externalSource: 'fieldroutes', externalId: { not: null } },
      select: { externalId: true },
    });
    const syncedIds = new Set(existingPayments.map((p: any) => p.externalId));

    const newPaymentIDs = allPaymentIDs.filter(id => !syncedIds.has(String(id)));

    if (newPaymentIDs.length === 0) {
      await prisma.syncLog.create({
        data: {
          source: `fieldroutes_payments_${office}`,
          status: 'success',
          mode: 'payment_sync',
          paymentsCreated: 0,
          invoicesUpdated: 0,
          startedAt,
          completedAt: new Date(),
          errors: 'No new payments to sync',
        },
      });
      return NextResponse.json({
        success: true,
        message: 'No new payments to sync',
        paymentsCreated: 0,
        invoicesUpdated: 0,
      });
    }

    const frPayments = await fetchPayments(key, token, newPaymentIDs);

    for (const frPayment of frPayments) {
      try {
        if (parseFloat(frPayment.appliedAmount) <= 0) continue;
        if (!frPayment.paymentApplications || frPayment.paymentApplications.length === 0) continue;

        for (const application of frPayment.paymentApplications) {
          const ticketId = String(application.ticketID);
          const appliedAmount = parseFloat(application.appliedAmount);
          if (appliedAmount <= 0) continue;

          const invoice = await prisma.invoice.findFirst({
            where: { externalId: ticketId, office },
          });

          if (!invoice) {
            errors.push(`No invoice found for ticket ${ticketId}`);
            errorCount++;
            continue;
          }

          const currentPaid = Number(invoice.paid);
          const totalAmount = Number(invoice.amount);
          const newPaid = Math.min(totalAmount, currentPaid + appliedAmount);
          const isFullyPaid = newPaid >= totalAmount;

          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              paid: newPaid,
              status: isFullyPaid ? 'PAID' : invoice.status,
            },
          });

          await prisma.payment.create({
            data: {
              invoiceId: invoice.id,
              date: new Date(frPayment.date),
              amount: appliedAmount,
              method: frPayment.cardType
                ? `${frPayment.cardType} ${frPayment.lastFour ? `****${frPayment.lastFour}` : ''}`.trim()
                : 'FieldRoutes',
              reference: frPayment.transactionID || null,
              note: frPayment.paymentSource || null,
              externalId: String(frPayment.paymentID),
              externalSource: 'fieldroutes',
            },
          });

          paymentsCreated++;
          invoicesUpdated++;
        }
      } catch (err: any) {
        errorCount++;
        errors.push(`Payment ${frPayment.paymentID}: ${err.message}`);
      }
    }

    await prisma.syncLog.create({
      data: {
        source: `fieldroutes_payments_${office}`,
        status: errorCount > 0 ? 'partial' : 'success',
        mode: 'payment_sync',
        paymentsCreated,
        invoicesUpdated,
        errorCount,
        errors: errors.slice(0, 50).join('\n') || null,
        startedAt,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Payment sync complete for ${office}`,
      newPaymentsFound: newPaymentIDs.length,
      paymentsCreated,
      invoicesUpdated,
      errorCount,
      errors: errors.slice(0, 20),
    });

  } catch (error: any) {
    await prisma.syncLog.create({
      data: {
        source: `fieldroutes_payments_${office}`,
        status: 'error',
        mode: 'payment_sync',
        paymentsCreated,
        invoicesUpdated,
        errorCount: errorCount + 1,
        errors: error.message,
        startedAt,
        completedAt: new Date(),
      },
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const logs = await prisma.syncLog.findMany({
    where: { source: { startsWith: 'fieldroutes_payments' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return NextResponse.json({ logs });
}
