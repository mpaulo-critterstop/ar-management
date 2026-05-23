import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { date, due, amount, paid, ...rest } = body;
    const invoice = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(date && { date: new Date(date) }),
        ...(due && { due: new Date(due) }),
        ...(amount !== undefined && { amount }),
        ...(paid !== undefined && { paid }),
      },
      include: { customer: true },
    });
    return NextResponse.json(invoice);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    await prisma.invoice.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
