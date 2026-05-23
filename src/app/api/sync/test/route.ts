import { NextResponse } from "next/server";

export async function GET() {
  const subdomain = process.env.FIELDROUTES_SUBDOMAIN || "";
  const key = process.env.FIELDROUTES_API_KEY || "";
  const token = process.env.FIELDROUTES_TOKEN || "";
  
  // Get first 5 ticket IDs
  const searchUrl = new URL(`https://${subdomain}.fieldroutes.com/api/ticket/search`);
  searchUrl.searchParams.set("authenticationKey", key);
  searchUrl.searchParams.set("authenticationToken", token);
  const search = await fetch(searchUrl.toString()).then(r => r.json());
  const ids = (search.ticketIDs || []).slice(0, 5);

  // Fetch those tickets
  const getUrl = new URL(`https://${subdomain}.fieldroutes.com/api/ticket/get`);
  getUrl.searchParams.set("ticketIDs", ids.join(","));
  getUrl.searchParams.set("authenticationKey", key);
  getUrl.searchParams.set("authenticationToken", token);
  const data = await fetch(getUrl.toString()).then(r => r.json());
  
  const tickets = (data.tickets || []).map((t: any) => ({
    ticketID: t.ticketID,
    customerID: t.customerID,
    total: t.total,
    balance: t.balance,
    invoiceDate: t.invoiceDate,
    invoiceNumber: t.invoiceNumber,
  }));

  return NextResponse.json({ tickets, totalCount: search.count });
}
