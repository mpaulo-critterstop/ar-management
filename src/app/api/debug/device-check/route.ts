import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const AUTH='https://auth.bouncie.com/oauth/token';
async function getToken() {
  const [t,e,r] = await Promise.all([
    prisma.appSetting.findUnique({where:{key:'bouncie_access_token'}}),
    prisma.appSetting.findUnique({where:{key:'bouncie_token_expires_at'}}),
    prisma.appSetting.findUnique({where:{key:'bouncie_refresh_token'}}),
  ]);
  if(!t||!r) throw new Error('not connected');
  if(e && new Date(e.value).getTime()-Date.now()>5*60*1000) return t.value;
  const res=await fetch(AUTH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:'critter-stop-',client_secret:process.env.BOUNCIE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:r.value})});
  const tk=await res.json();
  await prisma.appSetting.update({where:{key:'bouncie_access_token'},data:{value:tk.access_token}});
  await prisma.appSetting.update({where:{key:'bouncie_refresh_token'},data:{value:tk.refresh_token}});
  await prisma.appSetting.update({where:{key:'bouncie_token_expires_at'},data:{value:new Date(Date.now()+(tk.expires_in||3600)*1000).toISOString()}});
  return tk.access_token;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get('token') !== 'critterstop2026') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Live Bouncie fleet
  const token = await getToken();
  const vehicles = await fetch('https://api.bouncie.dev/v1/vehicles',{headers:{'Authorization':token}}).then(r=>r.json()).catch(()=>[]);
  const fleetImeis = new Set((Array.isArray(vehicles)?vehicles:[]).map((v:any)=>String(v.imei)));
  const fleetByImei = new Map((Array.isArray(vehicles)?vehicles:[]).map((v:any)=>[String(v.imei),v.nickName]));

  // All active techs with devices
  const techs = await prisma.technician.findMany({
    where: { status: 'ACTIVE' as any, bouncieDevice: { isNot: null } },
    select: { techId:true, name:true, bouncieDevice:{select:{deviceId:true,bouncieName:true}} },
    orderBy: { name:'asc' },
  });

  // For each, does their Hub imei exist in the live fleet?
  const mismatched = techs.filter(t => !fleetImeis.has(String(t.bouncieDevice?.deviceId)))
    .map(t => ({ techId:t.techId, name:t.name, hubImei:t.bouncieDevice?.deviceId, inFleet:false }));
  const matched = techs.filter(t => fleetImeis.has(String(t.bouncieDevice?.deviceId)))
    .map(t => ({ techId:t.techId, name:t.name, fleetName:fleetByImei.get(String(t.bouncieDevice?.deviceId)) }));

  return NextResponse.json({
    fleetVehicleCount: fleetImeis.size,
    activeTechsWithDevices: techs.length,
    MISMATCHED_hubImeiNotInFleet: mismatched,
    matched_sample: matched.slice(0,5),
    fleetNicknames: [...fleetByImei.values()],
  });
}
