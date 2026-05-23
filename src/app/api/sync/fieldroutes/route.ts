import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function makeUrl(subdomain: string, endpoint: string, action: string, params: Record<string, string> = {}, key: string, token: string) {
  const url = new URL(`https://${subdomain}.fieldroutes.com/api/${endpoint}/${action}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("authenticationKey", key);
  url.searchParams.set("authenticationToken", token);
  return url.toString();
}

export async function POST(req: NextRequest) {
  const subdomain = process.env.FIELDROUTES_SUBDOMAIN || "";
  const key = process.env.FIELDROUTES_API_KEY || "";
  const token = process.env.FIELDROUTES_TOKEN || "";

  if (!subdomain || !key || !token) {
    return NextResponse.json({ error: "FieldRoutes not configured" }, { status: 400 });
  }

  let customersCreated = 0, customersUpdated = 0;
  let invoicesCreated = 0, invoicesUpdated = 0;
  const errors: string[] = [];

  errors.push(`DEBUG env: key=${key.substring(0,8)}, subdomain=${subdomain}`);

  // Search for customer IDs
  try {
    const searchUrl = makeUrl(subdomain, "customer", "search", {}, key, token);
    const searchRes = await fetch(searchUrl);
    const search = await searchRes.json();
    errors.push(`DEBUG search: success=${search.success}, count=${search.count}, error=${search.errorMessage||"none"}`);

    const ids: number[] = search.customerIDs || [];

    // Fetch customers in batches of 100
    for (let i = 0; i < Math.min(ids.length, 500); i += 100) {
      const batch = ids.slice(i, i + 100);
      try {
        const batchUrl = makeUrl(subdomain, "customer", "get", { customerIDs: batch.join(",") }, key, token);
        const batchRes = await fetch(batchUrl);
        const data = await batchRes.json();
        const customers = data.customers || data.customer || data.data || [];
        errors.push(`DEBUG batch ${i}: keys=${Object.keys(data).join(",")}, count=${customers.length}`);

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
      } catch (e: any) { errors.push(`Batch ${i} error: ${e.message}`); }
    }
  } catch (e: any) {
    errors.push(`Customer sync failed: ${e.message}`);
  }

  // Search for invoice IDs
  try {
    const searchUrl = makeUrl(subdomain, "invoice", "search", {}, key, token);
    const searchRes = await fetch(searchUrl);
    const search = await searchRes.json();
    errors.push(`DEBUG invoice search: success=${search.success}, count=${search.count}`);

    const ids: number[] = search.invoiceIDs || [];

    for (let i = 0; i < Math.min(ids.length, 500); i += 100) {
      const batch = ids.slice(i, i + 100);
      try {
        const batchUrl = makeUrl(subdomain, "invoice", "get", { invoiceIDs: batch.join(",") }, key, token);
        const batchRes = await fetch(batchUrl);
        const data = await batchRes.json();
        const invoices = data.invoices || data.invoice || data.data || [];

        for (const fi of invoices) {
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
  } catch (e: any) {
    errors.push(`Invoice sync failed: ${e.message}`);
  }

  await prisma.syncLog.create({
    data: {
      source: "fieldroutes", status: errors.length === 0 ? "success" : "partial",
      mode: "incremental", startedAt: new Date(), completedAt: new Date(),
      customersCreated, customersUpdated, invoicesCreated, invoicesUpdated,
      paymentsCreated: 0, errorCount: errors.length, errors: errors.join("\n"),
    }
  });

  return NextResponse.json({ status: errors.length === 0 ? "success" : "partial", customersCreated, customersUpdated, invoicesCreated, invoicesUpdated, errors });
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
