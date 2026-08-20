import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function makeUrl(subdomain: string, endpoint: string, action: string, params: Record<string, string> = {}, key: string, token: string) {
  const url = new URL(`https://${subdomain}.fieldroutes.com/api/${endpoint}/${action}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("authenticationKey", key);
  url.searchParams.set("authenticationToken", token);
  return url.toString();
}

async function frFetch(url: string) {
  const res = await fetch(url);
  return res.json();
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

  try {
    // Search for tickets with a balance > 0
    const searchUrl = makeUrl(subdomain, "ticket", "search", { balance: ">0" }, key, token);
    const search = await frFetch(searchUrl);
    errors.push(`DEBUG ticket search: success=${search.success}, count=${search.count}, error=${search.errorMessage||"none"}`);

    const ticketIds: number[] = search.ticketIDs || [];
    errors.push(`DEBUG ticket IDs found: ${ticketIds.length}`);

    const customerIdsNeeded = new Set<number>();

    // Fetch tickets in batches of 100
    for (let i = 0; i < ticketIds.length; i += 100) {
      const batch = ticketIds.slice(i, i + 100);
      try {
        const batchUrl = makeUrl(subdomain, "ticket", "get", { ticketIDs: batch.join(",") }, key, token);
        const data = await frFetch(batchUrl);
        const tickets = data.tickets || [];

        for (const ft of tickets) {
          try {
            const balance = parseFloat(ft.balance || "0");
            if (balance <= 0) continue;
            customerIdsNeeded.add(parseInt(ft.customerID));

            // Make sure customer exists first
            let customer = await prisma.customer.findFirst({
              where: { externalId: String(ft.customerID), externalSource: "fieldroutes" }
            });

            if (!customer) {
              customer = await prisma.customer.create({
                data: {
                  name: `Customer ${ft.customerID}`,
                  externalId: String(ft.customerID),
                  externalSource: "fieldroutes",
                  terms: "Net 30",
                  status: "ACTIVE",
                }
              });
              customersCreated++;
            }

            const total = parseFloat(ft.total || "0");
            const paid = total - balance;
            const invoiceDate = new Date(ft.invoiceDate || ft.dateCreated);
            const days = Math.round((new Date().getTime() - invoiceDate.getTime()) / 86400000);
            const status = days > 90 ? "COLLECTIONS" : days > 0 ? "OVERDUE" : "CURRENT";
            const invId = `FR-TKT-${ft.ticketID}`;

            const existing = await prisma.invoice.findUnique({ where: { id: invId } });

            if (existing) {
              // Admin-reopened invoices (ongoing projects closed by mistake) are protected: refresh paid,
              // but do NOT recompute status — leave it as the admin set it, or it'd flip back to OVERDUE.
              if ((existing as any).arReopened) {
                await prisma.invoice.update({ where: { id: invId }, data: { paid } });
              } else {
                await prisma.invoice.update({ where: { id: invId }, data: { paid, status } });
              }
              invoicesUpdated++;
            } else {
              await prisma.invoice.create({
                data: {
                  id: invId,
                  customerId: customer.id,
                  date: invoiceDate,
                  due: invoiceDate,
                  amount: total,
                  paid,
                  status,
                  description: ft.invoiceNumber || `Ticket ${ft.ticketID}`,
                  externalId: String(ft.ticketID),
                  externalSource: "fieldroutes",
                  serviceType: "FieldRoutes",
                }
              });
              invoicesCreated++;
            }
          } catch (e: any) { errors.push(`Ticket ${ft.ticketID}: ${e.message}`); }
        }
      } catch (e: any) { errors.push(`Ticket batch ${i}: ${e.message}`); }
    }

    errors.push(`DEBUG customers needed: ${customerIdsNeeded.size}`);

    // Fetch real customer details
    const custIdArray = Array.from(customerIdsNeeded);
    for (let i = 0; i < custIdArray.length; i += 100) {
      const batch = custIdArray.slice(i, i + 100);
      try {
        const batchUrl = makeUrl(subdomain, "customer", "get", { customerIDs: batch.join(",") }, key, token);
        const data = await frFetch(batchUrl);
        const customers = data.customers || [];

        for (const fc of customers) {
          try {
            const name = [fc.fname, fc.lname].filter(Boolean).join(" ") || fc.companyName || `Customer ${fc.customerID}`;
            const status = fc.status === 1 || fc.status === "1" ? "ACTIVE" : "SUSPENDED";

            // Multi-property / commercial detection for AR automation exclusion.
            const custId = String(fc.customerID);
            const commercial = fc.commercialAccount === 1 || fc.commercialAccount === "1";
            const masterRaw = String(fc.masterAccount ?? "0");
            const hasMaster = masterRaw !== "0" && masterRaw !== "" && masterRaw !== custId;
            const billToRaw = String(fc.billToAccountID ?? custId);
            const billsElsewhere = billToRaw !== "0" && billToRaw !== "" && billToRaw !== custId;
            // Exclude residential-automation for: commercial, OR rolls up to a master, OR bills to another account.
            const excludeFromAutomation = commercial || hasMaster || billsElsewhere;

            const existing = await prisma.customer.findFirst({
              where: { externalId: String(fc.customerID), externalSource: "fieldroutes" }
            });
            if (existing) {
              await prisma.customer.update({
                where: { id: existing.id },
                data: {
                  name,
                  email: fc.email || undefined,
                  phone: fc.phone1 || undefined,
                  billingAddr: [fc.address, fc.city, fc.state, fc.zip].filter(Boolean).join(", ") || undefined,
                  serviceAddr: [fc.serviceAddress || fc.address, fc.serviceCity || fc.city, fc.serviceState || fc.state, fc.serviceZip || fc.zip].filter(Boolean).join(", ") || undefined,
                  status,
                  commercialAccount: commercial,
                  masterAccountId: hasMaster ? masterRaw : null,
                  billToAccountId: billsElsewhere ? billToRaw : null,
                  excludeFromAutomation,
                }
              });
              customersUpdated++;
            }
          } catch (e: any) { errors.push(`Customer update ${fc.customerID}: ${e.message}`); }
        }
      } catch (e: any) { errors.push(`Customer batch ${i}: ${e.message}`); }
    }

  } catch (e: any) {
    errors.push(`Sync failed: ${e.message}`);
  }

  // Geocode any customers that got a new serviceAddr but no lat/lng
  try {
    const toGeocode = await prisma.$queryRaw<Array<{id: string; serviceAddr: string}>>`
      SELECT id, "serviceAddr" FROM customers
      WHERE "serviceAddr" IS NOT NULL AND lat IS NULL
      LIMIT 100
    `;
    for (const c of toGeocode) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(c.serviceAddr)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!res?.ok) continue;
      const data = await res.json().catch(() => null);
      if (data?.status === 'OK' && data.results?.[0]) {
        const { lat, lng } = data.results[0].geometry.location;
        await prisma.$executeRaw`UPDATE customers SET lat = ${lat}, lng = ${lng}, "geocodedAt" = NOW() WHERE id = ${c.id}`;
      } else {
        await prisma.$executeRaw`UPDATE customers SET lat = 0, lng = 0, "geocodedAt" = NOW() WHERE id = ${c.id}`;
      }
      await new Promise(r => setTimeout(r, 50));
    }
  } catch { /* geocoding is best-effort */ }

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
