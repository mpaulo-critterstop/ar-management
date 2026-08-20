// Admin-only: reopen a mistakenly closed-out invoice for an ongoing project.
// Resets: due -> NULL, status -> CURRENT, arFollowupSent -> false, arStage -> NULL, unassign from blitz.
// Effect: drops off the call sheet (due IS NULL), drops off the AR Blitz (status=CURRENT AND due IS NULL),
// and stops PestAI/AR dunning (which only targets status=OVERDUE).
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any)?.role;
  const isAdmin = role === "Admin" || role === "ADMIN" || role === "LEADERSHIP";
  if (!isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

  try {
    const inv = await prisma.invoice.update({
      where: { id: params.id },
      data: {
        status: "CURRENT",
        due: null,
        arFollowupSent: false,
        arFollowupSentAt: null,
        arStage: null,
        arStageAt: null,
        blitzAssignedTo: null,
        updatedAt: new Date(),
      },
      include: { customer: true },
    });
    return NextResponse.json({ ok: true, invoice: inv });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
