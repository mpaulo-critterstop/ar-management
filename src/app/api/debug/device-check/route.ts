import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Get a fresh token
  const [tok, exp, ref] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: 'bouncie_access_token' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_token_expires_at' } }),
    prisma.appSetting.findUnique({ where: { key: 'bouncie_refresh_token' } }),
  ]);
  let token = tok?.value || '';
  const expiresAt = exp ? new Date(exp.value) : new Date(0);
  if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000 && ref) {
    const r = await fetch('https://auth.bouncie.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'critter-stop-', client_secret: process.env.BOUNCIE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: ref.value }) });
    if (r.ok) { const t = await r.json(); token = t.access_token;
      await prisma.appSetting.update({ where: { key: 'bouncie_access_token' }, data: { value: t.access_token } }).catch(()=>{});
      await prisma.appSetting.update({ where: { key: 'bouncie_refresh_token' }, data: { value: t.refresh_token } }).catch(()=>{});
      await prisma.appSetting.update({ where: { key: 'bouncie_token_expires_at' }, data: { value: new Date(Date.now()+(t.expires_in||3600)*1000).toISOString() } }).catch(()=>{});
    }
  }
  // Bouncie fleet
  const vehRes = await fetch('https://api.bouncie.dev/v1/vehicles', { headers: { 'Authorization': token } });
  const vehicles = await vehRes.json();
  const fleet = (Array.isArray(vehicles) ? vehicles : []).map((v: any) => ({ nickName: v.nickName, imei: v.imei }));
  // Megan's device imei
  const megan = await prisma.technician.findFirst({ where: { name: { contains: 'Delph' }, status: 'ACTIVE' }, select: { techId: true, bouncieDevice: { select: { deviceId: true, bouncieName: true } } } });
  const meganImei = megan?.bouncieDevice?.deviceId;
  const meganInFleet = fleet.find((v: any) => v.imei === meganImei);
  // Is there a vehicle actually named Megan?
  const meganNamedVehicle = fleet.filter((v: any) => (v.nickName || '').toLowerCase().includes('megan') || (v.nickName || '').toLowerCase().includes('delph'));
  return NextResponse.json({
    meganHubImei: meganImei,
    meganImeiFoundInBouncieFleet: meganInFleet || null,
    vehiclesNamedMegan: meganNamedVehicle,
    fleetSize: fleet.length,
    fleet: fleet.sort((a:any,b:any)=>(a.nickName||'').localeCompare(b.nickName||'')),
  });
}
