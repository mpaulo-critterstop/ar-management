import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canAccessModule } from '@/lib/access';
import { prisma } from '@/lib/prisma';

const GITHUB_RAW = 'https://raw.githubusercontent.com/mpaulo-critterstop/ar-management/main/prisma/dialpad-import';
const TOTAL_CHUNKS = 77;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessModule(session.user as any, 'dialpad')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const role = (session.user as any)?.role;
  if (role !== 'Admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const action = body.action || 'status';

  if (action === 'status') {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) FROM dialpad_calls`;
    return NextResponse.json({ count: Number((rows as any)[0].count) });
  }

  if (action === 'clear') {
    await prisma.$executeRaw`DELETE FROM dialpad_calls`;
    await prisma.$executeRaw`DELETE FROM dialpad_known_callers`;
    await prisma.$executeRaw`DELETE FROM dialpad_config WHERE key = 'last_sync_cursor'`;
    return NextResponse.json({ success: true });
  }

  if (action === 'chunk') {
    const chunk = Number(body.chunk);
    if (!chunk || chunk < 1 || chunk > TOTAL_CHUNKS) {
      return NextResponse.json({ error: 'Invalid chunk' }, { status: 400 });
    }
    const num = String(chunk).padStart(2, '0');
    const url = `${GITHUB_RAW}/dialpad_import_chunk_${num}.sql`;
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!res.ok) return NextResponse.json({ error: `Failed to fetch chunk ${chunk}: ${res.status}` }, { status: 500 });
    const sql = await res.text();
    await prisma.$executeRawUnsafe(sql);
    return NextResponse.json({ success: true, chunk });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
