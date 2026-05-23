import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { invoices } = body;

    let created = 0, skipped = 0, noCustomer = 0;
    const errors: string[] = [];

    for (const inv of invoices) {
      try {
        if (!inv.amount || inv.amount <= 0) { skipped++; continue; }

        // Find customer by FR ID
        const customer = await prisma.customer.findFirst({
          where: { externalId: String(inv.frId), externalSource: "fieldroutes" }
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
            due: new Date(inv.date),
            amount: inv.amount,
            paid: 0,
            status: new Date(inv.date) < new Date() ? "OVERDUE" : "CURRENT",
            externalId: String(inv.invoiceId),
            externalSource: "fieldroutes",
            serviceType: "FieldRoutes",
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
