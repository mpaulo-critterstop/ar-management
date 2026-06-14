import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (token !== 'critterstop2026') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const REPO = 'mpaulo-critterstop/ar-management';
  const BRANCH = 'main';
  const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/prisma/dialpad-import-recent`;
  const CHUNKS = 13;

  let imported = 0;
  const errors: string[] = [];

  for (let i = 1; i <= CHUNKS; i++) {
    const fname = `chunk_${String(i).padStart(2,'0')}.sql`;
    try {
      const resp = await fetch(`${BASE}/${fname}`);
      if (!resp.ok) { errors.push(`${fname}: HTTP ${resp.status}`); continue; }
      const sql = await resp.text();
      await prisma.$executeRawUnsafe(sql);
      imported++;
    } catch (e: any) {
      errors.push(`${fname}: ${e.message}`);
    }
  }

  return NextResponse.json({ ok: true, imported, errors });
}
