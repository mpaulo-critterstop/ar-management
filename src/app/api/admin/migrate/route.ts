import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST() {
  try {
    const customers = await prisma.customer.updateMany({
      where: { OR: [{ office: null }, { office: "" }] },
      data: { office: "DFW" }
    });
    const invoices = await prisma.invoice.updateMany({
      where: { OR: [{ office: null }, { office: "" }] },
      data: { office: "DFW" }
    });
    return NextResponse.json({ 
      customersUpdated: customers.count, 
      invoicesUpdated: invoices.count 
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
