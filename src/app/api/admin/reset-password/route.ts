import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function POST() {
  const pw = await bcrypt.hash("CritterstopAR!1", 10);
  await prisma.user.update({
    where: { email: "admin@critterstop.com" },
    data: { password: pw }
  });
  return NextResponse.json({ ok: true });
}
