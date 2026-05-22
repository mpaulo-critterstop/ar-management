import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const plans = await prisma.paymentPlan.findMany({
      include: {
        customer: { select: { name: true, email: true } },
        invoice: true,
        installments: { orderBy: { dueDate: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(plans);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { customerId, invoiceId, totalAmount, installments, rep, note } = body;

    const plan = await prisma.paymentPlan.create({
      data: {
        customerId, invoiceId, totalAmount, rep, note,
        installments: {
          create: installments.map((i: any) => ({
            dueDate: new Date(i.dueDate),
            amount: i.amount,
          })),
        },
      },
      include: { installments: true, customer: true },
    });

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "PAYMENT_PLAN" },
    });

    return NextResponse.json(plan, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
