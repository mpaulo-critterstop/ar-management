// src/app/api/admin/reset/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Extra safety — only ADMIN role can reset
  if (session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden — Admin only' }, { status: 403 });
  }

  const { confirm } = await req.json();
  if (confirm !== 'RESET_ALL_DATA') {
    return NextResponse.json({ 
      error: 'Must confirm with RESET_ALL_DATA' 
    }, { status: 400 });
  }

  try {
    // Delete in correct order to respect foreign keys
    const installments = await prisma.installment.deleteMany({});
    const paymentPlans = await prisma.paymentPlan.deleteMany({});
    const collectionNotes = await prisma.collectionNote.deleteMany({});
    const payments = await prisma.payment.deleteMany({});
    const syncLogs = await prisma.syncLog.deleteMany({});
    const invoices = await prisma.invoice.deleteMany({});
    const customers = await prisma.customer.deleteMany({});

    return NextResponse.json({
      success: true,
      message: 'All data cleared successfully',
      deleted: {
        installments: installments.count,
        paymentPlans: paymentPlans.count,
        collectionNotes: collectionNotes.count,
        payments: payments.count,
        syncLogs: syncLogs.count,
        invoices: invoices.count,
        customers: customers.count,
      }
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
