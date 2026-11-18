import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic='force-dynamic'; export const maxDuration=120;
const FR_BASE='https://critterstoppest.fieldroutes.com/api';
const parse=(s:string)=>new Date(String(s).replace(' ','T')+'Z').getTime();
const toCST=(s:string)=>{if(!s)return null;return new Date(parse(s)+2*3600*1000).toISOString().replace('T',' ').slice(0,19);};
export async function GET(req:NextRequest){
  const sp=req.nextUrl.searchParams;
  if(sp.get('token')!=='critterstop2026')return NextResponse.json({error:'Unauthorized'},{status:401});
  const empId=sp.get('empId')||'10822'; const date=sp.get('date')||'2026-11-10';
  const c=FR_OFFICES.DFW; const auth=`authenticationKey=${c.key}&authenticationToken=${c.token}`;
  const s=`${date} 00:00:00`,e=`${date} 23:59:59`;
  const locJson=await (await fetch(`${FR_BASE}/employeeLocation/search?employeeID=${encodeURIComponent(JSON.stringify({operator:'=',value:empId}))}&time=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:[s,e]}))}&includeData=1&${auth}`)).json().catch(()=>null);
  let locs=locJson?.employeeLocations||[];
  if(!locs.length&&(locJson?.employeeLocationIDs||[]).length){const g=await fetch(`${FR_BASE}/employeeLocation/get?employeeLocationIDs=${locJson.employeeLocationIDs.slice(0,600).join(',')}&${auth}`);locs=(await g.json().catch(()=>null))?.employeeLocations||[];}
  locs=locs.filter((l:any)=>String(l.employeeID)===empId).sort((a:any,b:any)=>String(a.time).localeCompare(String(b.time)));
  return NextResponse.json({date,empId,gpsCount:locs.length,
    lastPoints:locs.slice(-12).map((l:any)=>({timeCST:toCST(l.time),lat:l.latitude,lng:l.longitude})),
  });
}
