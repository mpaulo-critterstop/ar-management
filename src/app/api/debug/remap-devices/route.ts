import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const AUTH='https://auth.bouncie.com/oauth/token';
async function getToken(){const[t,e,r]=await Promise.all([prisma.appSetting.findUnique({where:{key:'bouncie_access_token'}}),prisma.appSetting.findUnique({where:{key:'bouncie_token_expires_at'}}),prisma.appSetting.findUnique({where:{key:'bouncie_refresh_token'}})]);if(!t||!r)throw new Error('nc');if(e&&new Date(e.value).getTime()-Date.now()>3e5)return t.value;const res=await fetch(AUTH,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:'critter-stop-',client_secret:process.env.BOUNCIE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:r.value})});const tk=await res.json();await prisma.appSetting.update({where:{key:'bouncie_access_token'},data:{value:tk.access_token}});await prisma.appSetting.update({where:{key:'bouncie_refresh_token'},data:{value:tk.refresh_token}});await prisma.appSetting.update({where:{key:'bouncie_token_expires_at'},data:{value:new Date(Date.now()+(tk.expires_in||3600)*1e3).toISOString()}});return tk.access_token;}
const norm=(s:string)=>(s||'').toLowerCase().replace(/[^a-z]/g,'');
export async function GET(req: NextRequest) {
  const sp=req.nextUrl.searchParams;
  if(sp.get('token')!=='critterstop2026')return NextResponse.json({error:'Unauthorized'},{status:401});
  const apply=sp.get('apply')==='1';
  const token=await getToken();
  const vehicles=await fetch('https://api.bouncie.dev/v1/vehicles',{headers:{'Authorization':token}}).then(r=>r.json()).catch(()=>[]);
  const fleet=new Map();
  (Array.isArray(vehicles)?vehicles:[]).forEach((v)=>{ if(v.nickName && !/vacant|office|shop|richardson/i.test(v.nickName)) fleet.set(norm(v.nickName),{imei:String(v.imei),nick:v.nickName}); });
  const techs=await prisma.technician.findMany({where:{status:'ACTIVE'},select:{id:true,techId:true,name:true,bouncieDevice:{select:{id:true,deviceId:true}}}});
  const plan=[];
  for(const t of techs){
    const match=fleet.get(norm(t.name));
    if(!match){ plan.push({tech:t.name,action:'NO_FLEET_MATCH',currentImei:t.bouncieDevice?.deviceId||null}); continue; }
    const cur=t.bouncieDevice?.deviceId||null;
    if(cur===match.imei){ plan.push({tech:t.name,action:'OK'}); continue; }
    plan.push({tech:t.name,action: cur?'FIX':'ADD', from:cur, to:match.imei, fleetNick:match.nick, deviceRowId:t.bouncieDevice?.id||null, techRowId:t.id});
  }
  if(apply){
    let fixed=0, added=0;
    for(const p of plan){
      if(p.action==='FIX' && p.deviceRowId){ await prisma.bouncieDevice.update({where:{id:p.deviceRowId},data:{deviceId:p.to,bouncieName:p.tech}}); fixed++; }
      else if(p.action==='ADD' && p.techRowId){ await prisma.bouncieDevice.create({data:{technicianId:p.techRowId,bouncieName:p.tech,deviceId:p.to}}).catch(()=>{}); added++; }
    }
    return NextResponse.json({mode:'APPLIED',fixed,added, changes:plan.filter(p=>p.action!=='OK')});
  }
  return NextResponse.json({mode:'PREVIEW (add &apply=1)', summary:{ ok:plan.filter(p=>p.action==='OK').length, fix:plan.filter(p=>p.action==='FIX').length, add:plan.filter(p=>p.action==='ADD').length, noMatch:plan.filter(p=>p.action==='NO_FLEET_MATCH').length }, changes:plan.filter(p=>p.action!=='OK')});
}
