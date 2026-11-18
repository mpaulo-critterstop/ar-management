import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic='force-dynamic'; export const maxDuration=180;
const FR_BASE='https://critterstoppest.fieldroutes.com/api';
function miles(a:number,b:number,c:number,d:number){const R=3958.8,r=(x:number)=>x*Math.PI/180;const dLat=r(c-a),dLng=r(d-b);const h=Math.sin(dLat/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const parse=(s:string)=>new Date(String(s).replace(' ','T')+'Z').getTime();
const toCST=(s:string)=>{if(!s)return null;return new Date(parse(s)+2*3600*1000).toISOString().replace('T',' ').slice(11,19);};
const SITE_RADIUS=0.12; // miles — "at the appointment" if GPS within ~630ft

export async function GET(req:NextRequest){
  const sp=req.nextUrl.searchParams;
  if(sp.get('token')!=='critterstop2026')return NextResponse.json({error:'Unauthorized'},{status:401});
  const empId=sp.get('empId')||'10656'; const date=sp.get('date')||'2026-10-16';
  const radius=parseFloat(sp.get('radius')||'')||SITE_RADIUS;
  let cfg:any=null;
  for(const [office,c] of Object.entries(FR_OFFICES)){if(!c.key)continue;const auth=`authenticationKey=${c.key}&authenticationToken=${c.token}`;const j=await (await fetch(`${FR_BASE}/employee/get?employeeIDs=${empId}&${auth}`)).json().catch(()=>null);if(j?.employees?.length){cfg={...c,office,name:`${j.employees[0].fname} ${j.employees[0].lname}`};break;}}
  if(!cfg)return NextResponse.json({error:'not found'},{status:404});
  const auth=`authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  const s=`${date} 00:00:00`,e=`${date} 23:59:59`;

  // GPS trail
  const locJson=await (await fetch(`${FR_BASE}/employeeLocation/search?employeeID=${encodeURIComponent(JSON.stringify({operator:'=',value:empId}))}&time=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:[s,e]}))}&includeData=1&${auth}`)).json().catch(()=>null);
  let locs=locJson?.employeeLocations||[];
  if(!locs.length&&(locJson?.employeeLocationIDs||[]).length){const g=await fetch(`${FR_BASE}/employeeLocation/get?employeeLocationIDs=${locJson.employeeLocationIDs.slice(0,600).join(',')}&${auth}`);locs=(await g.json().catch(()=>null))?.employeeLocations||[];}
  locs=locs.filter((l:any)=>String(l.employeeID)===empId).map((l:any)=>({t:parse(l.time),time:l.time,lat:+l.latitude,lng:+l.longitude})).sort((a:any,b:any)=>a.t-b.t);

  // appointments
  const apJson=await (await fetch(`${FR_BASE}/appointment/search?date=${encodeURIComponent(JSON.stringify({operator:'=',value:date}))}&servicedBy=${empId}&includeData=1&${auth}`)).json().catch(()=>null);
  let appts=apJson?.appointments||[];
  if(!appts.length&&(apJson?.appointmentIDs||[]).length){const g=await fetch(`${FR_BASE}/appointment/get?appointmentIDs=${apJson.appointmentIDs.slice(0,50).join(',')}&${auth}`);appts=(await g.json().catch(()=>null))?.appointments||[];}

  // for each appt, find GPS points within radius; dwell = last-in-window minus first-in-window
  const results=[];
  for(const a of appts){
    const alat=+a.latIn||null, alng=+a.longIn||null;
    if(alat==null||isNaN(alat)){results.push({appt:a.appointmentID,note:'no appt GPS to anchor'});continue;}
    const near=locs.filter((l:any)=>miles(l.lat,l.lng,alat,alng)<=radius);
    let dwellMin=null, firstAt=null, lastAt=null, pts=near.length;
    if(near.length>=1){ firstAt=near[0].time; lastAt=near[near.length-1].time; dwellMin=+(((near[near.length-1].t-near[0].t)/60000)).toFixed(1); }
    results.push({
      appointmentID:a.appointmentID, apptGPS:`${alat},${alng}`,
      frCheckIn:toCST(a.checkIn||a.timeIn), frCheckOut:toCST(a.checkOut||a.timeOut),
      gpsPointsNearSite:pts, gpsFirstAt:toCST(firstAt), gpsLastAt:toCST(lastAt),
      gpsDwellMinutes:dwellMin,
    });
  }
  // sort by gps first-at
  results.sort((x:any,y:any)=>String(x.gpsFirstAt||'~').localeCompare(String(y.gpsFirstAt||'~')));
  return NextResponse.json({employee:cfg.name,date,radiusMiles:radius,totalGps:locs.length,appointments:results});
}
