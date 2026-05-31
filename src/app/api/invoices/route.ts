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
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "100");
    const skip = (page - 1) * limit;
    const officeFilter = officeParam || (office !== "ALL" ? office : null);

    const where: any = {
      ...(officeFilter && { office: { equals: officeFilter, mode: 'insensitive' } }),
      ...(status && { status: status as any }),
      // Only show invoices with amount > 0 (hides $0 appointment invoices)
      amount: { gt: 0 },
      ...(search && {
        OR: [
          { id: { contains: search, mode: "insensitive" } },
          { customer: { name: { contains: search, mode: "insensitive" } } },
        ],
      }),
    };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, email: true, contact: true, terms: true, rep: true },
          },
        },
        orderBy: { due: "asc" },
        skip,
        take: limit,
      }),
      prisma.invoice.count({ where }),
    ]);

    return NextResponse.json({ invoices, total, page, limit, pages: Math.ceil(total / limit) });
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
