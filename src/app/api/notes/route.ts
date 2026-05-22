import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");

    const notes = await prisma.collectionNote.findMany({
      where: { ...(customerId && { customerId }) },
      include: {
        customer: { select: { name: true } },
        user: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: 100,
    });
    return NextResponse.json(notes);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { customerId, invoiceId, text, status, followUpDate, promisedDate, promisedAmount, userId } = body;

    const note = await prisma.collectionNote.create({
      data: {
        customerId, invoiceId, text, status, userId,
        ...(followUpDate && { followUpDate: new Date(followUpDate) }),
        ...(promisedDate && { promisedDate: new Date(promisedDate) }),
        ...(promisedAmount && { promisedAmount }),
      },
      include: { customer: { select: { name: true } } },
    });
    return NextResponse.json(note, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
