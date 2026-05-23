import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const BASE = `https://${process.env.FIELDROUTES_SUBDOMAIN}.fieldroutes.com/api`;

function frUrl(path: string, params: Record<string, string> = {}) {
  const url = new URL(BASE + path);
  url.searchParams.set("authenticationKey", process.env.FIELDROUTES_API_KEY || "");
  url.searchParams.set("authenticationToken", process.env.FIELDROUTES_TOKEN || "");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

async function frGet(path: string, params: Record<string, string> = {}) {
  const res = await fetch(frUrl(path, params), {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`FieldRoutes ${path} returned ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.FIELDROUTES_SUBDOMAIN || !process.env.FIELDROUTES_API_KEY || !process.env.FIELDROUTES_TOKEN) {
      return NextResponse.json({ error: "FieldRoutes not configured — need FIELDROUTES_SUBDOMAIN, FIELDROUTES_API_KEY and FIELDROUTES_TOKEN" }, { status: 400 });
    }

    let customersCreated = 0, customersUpdated = 0;
    let invoicesCreated = 0, invoicesUpdated = 0;
    const errors: string[] = [];

    // Search for customer IDs first, then fetch details
    try {
      const search = await frGet("/customer/search");
      const ids: number[] = search.ids || [];
      
      // Fetch in batches of 100
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          const data = await frGet("/customer", { customerIDs: batch.join(",") });
          const customers = data.customers || data.data || [];
          for (const fc of customers) {
            try {
              const name = [fc.fname, fc.lname].filter(Boolean).join(" ") || fc.companyName || `Customer ${fc.customerID}`;
              const status = fc.status === 1 ? "ACTIVE" : "SUSPENDED";
              const existing = await prisma.customer.findFirst({
                where: { externalId: String(fc.customerID), externalSource: "fieldroutes" }
              });
              if (existing) {
                await prisma.customer.update({
                  where: { id: existing.id },
                  data: { name, email: fc.email||undefined, phone: fc.phone1||undefined, status }
                });
                customersUpdated++;
              } else {
                await prisma.customer.create({
                  data: { name, email: fc.email||undefined, phone: fc.phone1||undefined, status, externalId: String(fc.customerID), externalSource: "fieldroutes", terms: "Net 30" }
                });
                customersCreated++;
              }
            } catch (e: any) { errors.push(`Customer ${fc.customerID}: ${e.message}`); }
          }
        } catch (e: any) { errors.push(`Customer batch ${i}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(`Customer search failed: ${e.message}`); }

    // Search for invoice IDs then fetch details
    try {
      const search = await frGet("/invoice/search");
      const ids: number[] = search.ids || [];

      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        try {
          const data = await frGet("/invoice", { invoiceIDs: batch.join(",") });
          const invoices = data.invoices || data.data || [];
          for (const fi of invoices) {
            if (fi.status === 2) continue;
            try {
              const customer = await prisma.customer.findFirst({
                where: { externalId: String(fi.customerID), externalSource: "fieldroutes" }
              });
              if (!customer) continue;
              const paid = (fi.total || 0) - (fi.balance || 0);
              const days = Math.round((new Date().getTime() - new Date(fi.dueDate).getTime()) / 86400000);
              const status = (fi.balance || 0) <= 0 ? "PAID" : days > 90 ? "COLLECTIONS" : days > 0 ? "OVERDUE" : "CURRENT";
              const invId = `FR-INV-${fi.invoiceID}`;
              const existing = await prisma.invoice.findUnique({ where: { id: invId } });
              if (existing) {
                await prisma.invoice.update({ where: { id: invId }, data: { paid, status } });
                invoicesUpdated++;
              } else {
                await prisma.invoice.create({
                  data: { id: invId, customerId: customer.id, date: new Date(fi.serviceDate || fi.date), due: new Date(fi.dueDate), amount: fi.total || 0, paid, status, externalId: String(fi.invoiceID), externalSource: "fieldroutes", serviceType: "FieldRoutes" }
                });
                invoicesCreated++;
              }
            } catch (e: any) { errors.push(`Invoice ${fi.invoiceID}: ${e.message}`); }
          }
        } catch (e: any) { errors.push(`Invoice batch ${i}: ${e.message}`); }
      }
    } catch (e: any) { errors.push(`Invoice search failed: ${e.message}`); }

    await prisma.syncLog.create({
      data: {
        source: "fieldroutes",
        status: errors.length === 0 ? "success" : "partial",
        mode: "incremental",
        startedAt: new Date(),
        completedAt: new Date(),
        customersCreated, customersUpdated,
        invoicesCreated, invoicesUpdated,
        paymentsCreated: 0,
        errorCount: errors.length,
        errors: errors.join("\n"),
      }
    });

    return NextResponse.json({
      status: errors.length === 0 ? "success" : "partial",
      customersCreated, customersUpdated,
      invoicesCreated, invoicesUpdated,
      errors
    });
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
