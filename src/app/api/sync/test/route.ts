import { NextResponse } from "next/server";

export async function GET() {
  const subdomain = process.env.FIELDROUTES_SUBDOMAIN || "";
  const key = process.env.FIELDROUTES_API_KEY || "";
  const token = process.env.FIELDROUTES_TOKEN || "";
  
  const url = new URL(`https://${subdomain}.fieldroutes.com/api/invoice/search`);
  url.searchParams.set("authenticationKey", key);
  url.searchParams.set("authenticationToken", token);
  
  try {
    const res = await fetch(url.toString());
    const text = await res.text();
    return NextResponse.json({ 
      status: res.status,
      body: text.substring(0, 2000)
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}
