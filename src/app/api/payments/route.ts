import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;

    const { searchParams } = new URL(req.url);
    const days = parseInt(searchParams.get("days") || "90");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const officeParam = searchParams.get("office");
const officeFilter = (officeParam && officeParam !== "ALL") ? officeParam : (office && office !== "ALL" && office !== "ADMIN" ? office : null);
    
    // Build the where clause cleanly. Only add the invoice-office constraint when we actually have an
    // office filter — an empty `invoice: {}` relation filter forces an unnecessary join and can misbehave.
    const where: any = { date: { gte: cutoff } };
    if (officeFilter) {
      where.invoice = { office: { equals: officeFilter, mode: 'insensitive' } };
    }

    const payments = await prisma.payment.findMany({
      where,
      select: {
        id: true, invoiceId: true, amount: true, date: true,
        paymentSource: true, processedBy: true, externalId: true, externalSource: true,
        invoice: { select: { office: true, customer: { select: { name: true } } } },
      },
      orderBy: { date: "desc" },
      take: 5000, // cap to avoid unbounded, join-heavy result that was timing out (payments 500)
    });
    return NextResponse.json(payments);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { invoiceId, amount, date, method, reference, note } = body;

    const payment = await prisma.$transaction(async (tx: any) => {
      const pay = await tx.payment.create({
        data: { invoiceId, amount, date: new Date(date), method, reference, note },
      });
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (inv) {
        const newPaid = Number(inv.paid) + Number(amount);
        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            paid: newPaid,
            status: newPaid >= Number(inv.amount) ? "PAID" : inv.status,
          },
        });
      }
      return pay;
    });
    return NextResponse.json(payment, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
