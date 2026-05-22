import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BASE = `https://${process.env.FIELDROUTES_SUBDOMAIN}.fieldroutes.com/api/v1`;
const HEADERS = {
  "Authorization": `Bearer ${process.env.FIELDROUTES_API_KEY}`,
  "Content-Type": "application/json",
};

async function frGet(path: string) {
  const res = await fetch(BASE + path, { headers: HEADERS });
  if (!res.ok) throw new Error(`FieldRoutes ${path} returned ${res.status}`);
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FIELDROUTES_SUBDOMAIN || !process.env.FIELDROUTES_API_KEY) {
      return NextResponse.json({ error: "FieldRoutes not configured" }, { status: 400 });
    }

    let customersCreated = 0, customersUpdated = 0;
    let invoicesCreated = 0, invoicesUpdated = 0;
    let paymentsCreated = 0;
    const errors: string[] = [];

    // Sync customers
    try {
      const data = await frGet("/customer?limit=100&offset=0");
      for (const fc of data.data || []) {
        try {
          const name = [fc.fname, fc.lname].filter(Boolean).join(" ") || fc.companyName || `Customer ${fc.customerID}`;
          const status = fc.status === 1 ? "ACTIVE" : "SUSPENDED";
          const existing = await prisma.customer.findFirst({
            where: { externalId: String(fc.customerID), externalSource: "fieldroutes" }
          });
          if (existing) {
            await prisma.customer.update({ where: { id: existing.id }, data: { name, email: fc.email||undefined, phone: fc.phone||undefined, status } });
            customersUpdated++;
          } else {
            await prisma.customer.create({ data: { name, email: fc.email||undefined, phone: fc.phone||undefined, status, externalId: String(fc.customerID), externalSource: "fieldroutes", terms: "Net 30" } });
            customersCreated++;
          }
        } catch (e: any) { errors.push(`Customer ${fc.customerID}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(`Customers fetch failed: ${e.message}`); }

    // Sync invoices
    try {
      const data = await frGet("/invoice?limit=100&offset=0");
      for (const fi of data.data || []) {
        if (fi.status === 2) continue;
        try {
          const customer = await prisma.customer.findFirst({ where: { externalId: String(fi.customerID), externalSource: "fieldroutes" } });
          if (!customer) continue;
          const paid = fi.total - fi.balance;
          const days = Math.round((new Date().getTime() - new Date(fi.dueDate).getTime()) / 86400000);
          const status = fi.balance <= 0 ? "PAID" : days > 90 ? "COLLECTIONS" : days > 0 ? "OVERDUE" : "CURRENT";
          const invId = `FR-INV-${fi.invoiceID}`;
          const existing = await prisma.invoice.findUnique({ where: { id: invId } });
          if (existing) {
            await prisma.invoice.update({ where: { id: invId }, data: { paid, status } });
            invoicesUpdated++;
          } else {
            await prisma.invoice.create({ data: { id: invId, customerId: customer.id, date: new Date(fi.serviceDate), due: new Date(fi.dueDate), amount: fi.total, paid, status, externalId: String(fi.invoiceID), externalSource: "fieldroutes", serviceType: "FieldRoutes" } });
            invoicesCreated++;
          }
        } catch (e: any) { errors.push(`Invoice ${fi.invoiceID}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(`Invoices fetch failed: ${e.message}`); }

    // Log the sync
    await prisma.syncLog.create({
      data: {
        source: "fieldroutes", status: errors.length === 0 ? "success" : "partial",
        mode: "incremental", startedAt: new Date(), completedAt: new Date(),
        customersCreated, customersUpdated, invoicesCreated, invoicesUpdated,
        paymentsCreated, errorCount: errors.length, errors: errors.join("\n"),
      }
    });

    return NextResponse.json({ status: errors.length === 0 ? "success" : "partial", customersCreated, customersUpdated, invoicesCreated, invoicesUpdated, paymentsCreated, errors });
  } catch (e: any) {
    return NextResponse.json({ error:

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const logs = await prisma.syncLog.findMany({
      where: { source: "fieldroutes" },
      orderBy: { startedAt: "desc" },
      take: 10,
    });
    return NextResponse.json(logs);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
