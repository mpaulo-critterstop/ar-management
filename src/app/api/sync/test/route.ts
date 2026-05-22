import { NextResponse } from "next/server";

export async function GET() {
  const base = `https://${process.env.FIELDROUTES_SUBDOMAIN}.fieldroutes.com/api/v1`;
  const url = new URL(base + "/customer/search");
  url.searchParams.set("authenticationKey", process.env.FIELDROUTES_API_KEY || "");
  url.searchParams.set("authenticationToken", process.env.FIELDROUTES_TOKEN || "");
  
  try {
    const res = await fetch(url.toString());
    const text = await res.text();
    return NextResponse.json({ 
      status: res.status, 
      url: url.toString().replace(process.env.FIELDROUTES_API_KEY || "", "***").replace(process.env.FIELDROUTES_TOKEN || "", "***"),
      body: text.substring(0, 2000)
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}
