import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const officeParam = searchParams.get("office");
    const officeFilter = officeParam || (office !== "ALL" ? office : null);

    const invoices = await prisma.invoice.findMany({
      where: {
        ...(officeFilter && { office: { equals: officeFilter, mode: 'insensitive' } }),
        ...(status && { status: status as any }),
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
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;

    const body = await req.json();
    const { date, due, ...rest } = body;
    const invoice = await prisma.invoice.create({
      data: {
        ...rest,
        office: rest.office || (office !== "ALL" ? office : "DFW"),
        date: new Date(date),
        ...(due && { due: new Date(due) }),
      },
      include: { customer: true },
    });
    return NextResponse.json(invoice, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
