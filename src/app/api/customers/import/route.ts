import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const office = (session?.user as any)?.office;

    const body = await req.json();
    const { customers, office: bodyOffice } = body;
    const effectiveOffice = bodyOffice && bodyOffice !== "ALL" ? bodyOffice : "DFW";

    let created = 0, skipped = 0;
    const errors: string[] = [];

    for (const c of customers) {
      if (!c.name) { skipped++; continue; }
      try {
        const existing = c.externalId
          ? await prisma.customer.findFirst({ where: { externalId: c.externalId, externalSource: "fieldroutes", office: office !== "ALL" ? office : undefined } })
          : null;
        if (existing) { skipped++; continue; }
        await prisma.customer.create({
          data: {
            name: c.name,
            email: c.email || undefined,
            phone: c.phone || undefined,
            contact: c.contact || undefined,
            billingAddr: c.billingAddr || undefined,
            status: c.status || "ACTIVE",
            rep: c.rep || undefined,
            terms: c.terms || "Net 30",
            notes: c.notes || undefined,
            externalId: c.externalId || undefined,
            externalSource: c.externalId ? "fieldroutes" : undefined,
            office: effectiveOffice,
          }
        });
        created++;
      } catch (e: any) { errors.push(`${c.name}: ${e.message}`); }
    }

    return NextResponse.json({ created, skipped, errors });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
