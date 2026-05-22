import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const branch = searchParams.get("branch");
    const search = searchParams.get("search");

    const invoices = await prisma.invoice.findMany({
      where: {
        ...(status && { status: status as any }),
        ...(branch && { branch }),
        ...(search && {
          OR: [
            { id: { contains: search, mode: "insensitive" } },
            { customer: { name: { contains: search, mode: "insensitive" } } },
          ],
        }),
      },
      include: {
        customer: {
          select: { id:true, name:true, email:true, contact:true, terms:true, rep:true },
        },
      },
      orderBy: { due: "asc" },
    });
    return NextResponse.json(invoices);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, due, ...rest } = body;
    const invoice = await prisma.invoice.create({
      data: {
        ...rest,
        date: new Date(date),
        due: new Date(due),
      },
      include: { customer: true },
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
