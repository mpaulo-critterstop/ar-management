import { NextResponse } from "next/server";

export async function GET() {
  const subdomain = process.env.FIELDROUTES_SUBDOMAIN || "";
  const key = process.env.FIELDROUTES_API_KEY || "";
  const token = process.env.FIELDROUTES_TOKEN || "";
  
  const url = new URL(`https://${subdomain}.fieldroutes.com/api/ticket/search`);
  url.searchParams.set("balance", ">0");
  url.searchParams.set("authenticationKey", key);
  url.searchParams.set("authenticationToken", token);
  
  try {
    const res = await fetch(url.toString());
    const data = await res.json();
    return NextResponse.json({ 
      success: data.success,
      count: data.count,
      error: data.errorMessage || null,
      idName: data.idName,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message });
  }
}
