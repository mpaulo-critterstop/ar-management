import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;

    const body = await req.json();
    const { invoices, office: bodyOffice } = body;
    const effectiveOffice = bodyOffice && bodyOffice !== "ALL" ? bodyOffice : "DFW";

    let created = 0, skipped = 0, noCustomer = 0;
    const errors: string[] = [];

    for (const inv of invoices) {
      try {
        if (!inv.amount || inv.amount <= 0) { skipped++; continue; }

        // Find customer by FR ID and office
        const customer = await prisma.customer.findFirst({
          where: {
            externalId: String(inv.frId),
            externalSource: "fieldroutes",
            ...(office && office !== "ALL" && { office }),
          }
        });

        if (!customer) { noCustomer++; continue; }

        // Skip if invoice already exists
        const existing = await prisma.invoice.findUnique({
          where: { id: String(inv.invoiceId) }
        });
        if (existing) { skipped++; continue; }

        await prisma.invoice.create({
          data: {
            id: String(inv.invoiceId),
            customerId: customer.id,
            date: new Date(inv.date),
            amount: inv.amount,
            paid: 0,
            status: "CURRENT",
            externalId: String(inv.invoiceId),
            externalSource: "fieldroutes",
            serviceType: "FieldRoutes",
            office: effectiveOffice,
          }
        });
        created++;
      } catch (e: any) { errors.push(`Invoice ${inv.invoiceId}: ${e.message}`); }
    }

    return NextResponse.json({ created, skipped, noCustomer, errors });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
