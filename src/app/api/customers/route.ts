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

    const customers = await prisma.customer.findMany({
      where: {
        ...(officeFilter && { office: officeFilter }),
        ...(status && { status: status as any }),
        ...(search && {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        }),
      },
      include: {
        invoices: {
          select: { id:true, amount:true, paid:true, status:true, due:true },
        },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(customers);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;

    const body = await req.json();
    const customerOffice = body.office || (office !== "ALL" ? office : "DFW");
    const customer = await prisma.customer.create({
      data: { ...body, office: customerOffice }
    });
    return NextResponse.json(customer, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
