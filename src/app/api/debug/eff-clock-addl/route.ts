import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const FR_BASE = 'https://critterstoppest.fieldroutes.com/api';

const BUSINESS_LOCATIONS = [
  // DFW Offices
  { name: 'Southlake HQ',          lat: 32.9244,  lng: -97.1252 },
  { name: 'Haltom City',           lat: 32.8121,  lng: -97.2698 },
  { name: 'Haltom City Bradley A', lat: 32.7973383, lng: -97.2491626 },
  { name: 'Haltom City Bradley B', lat: 32.7971766, lng: -97.2487747 },
  { name: 'Haltom City Bradley C', lat: 32.7969712, lng: -97.2489500 },
  { name: 'Oak Lawn Dallas',        lat: 32.8198,  lng: -96.8209 },
  { name: 'Richardson',             lat: 32.9581813, lng: -96.7170318 },
  { name: 'The Colony',             lat: 33.0862,  lng: -96.8884 },
  { name: 'Justin',                 lat: 33.0748,  lng: -97.2951 },
  // ATX
  { name: 'Austin Office',          lat: 30.3806345, lng: -97.7239255 },
  { name: 'Austin S Capital Office', lat: 30.2874081, lng: -97.82458 },
  // OKC
  { name: 'OKC Office',             lat: 35.4442,  lng: -97.5198 },
  // CStat
  { name: 'College Station Office', lat: 30.5856,  lng: -96.3063 },
  // Suppliers
  { name: 'Control Source',         lat: 33.0417197, lng: -96.9918763 },
  { name: 'Veseris Dallas',         lat: 32.8972,  lng: -96.7537 },
  { name: 'Veseris Grand Prairie',  lat: 32.7459,  lng: -97.0208 },
  // Home Depot DFW
  { name: 'Home Depot Dallas FW Ave',    lat: 32.7560, lng: -96.8645 },
  { name: 'Home Depot Irving 8555',      lat: 32.9234, lng: -96.9804 },
  { name: 'Home Depot Irving 3200',      lat: 32.8336, lng: -96.9911 },
  { name: 'Home Depot Dallas Lemmon',    lat: 32.8340, lng: -96.8275 },
  { name: 'Home Depot Dallas Grissom',   lat: 32.9080, lng: -96.8845 },
  { name: 'Home Depot Euless',           lat: 32.8348, lng: -97.0982 },
  { name: 'Home Depot Dallas Skillman',  lat: 32.8607, lng: -96.7497 },
  { name: 'Home Depot FW N Fwy',         lat: 32.8704, lng: -97.3130 },
  { name: 'Home Depot FW S Fwy',         lat: 32.6332, lng: -97.3239 },
  { name: 'Home Depot Plano',            lat: 33.0990, lng: -96.7943 },
  { name: 'Home Depot Lewisville',       lat: 33.0538, lng: -97.0128 },
  { name: 'Home Depot Flower Mound',     lat: 32.9927, lng: -97.0606 },
  // Lowes DFW
  { name: 'Lowes Dallas Lemmon',         lat: 32.8306, lng: -96.8288 },
  { name: 'Lowes Dallas Chalk Hill',     lat: 32.7645, lng: -96.9012 },
  { name: 'Lowes Euless',                lat: 32.8800, lng: -97.0962 },
  { name: 'Lowes Dallas Inwood',         lat: 32.9118, lng: -96.8166 },
  { name: 'Lowes Southlake',             lat: 32.9417, lng: -97.1139 },
  { name: 'Lowes Keller',                lat: 32.8975, lng: -97.2393 },
  { name: 'Lowes FW Eastchase',          lat: 32.7640, lng: -97.1654 },
  { name: 'Lowes Hurst',                 lat: 32.8586, lng: -97.1837 },
  { name: 'Lowes Dallas Preston',        lat: 33.0105, lng: -96.7914 },
  { name: 'Lowes McKinney',              lat: 33.1293, lng: -96.7258 },
  { name: 'Lowes Allen',                 lat: 33.1023, lng: -96.6860 },
  { name: 'Lowes Frisco',                lat: 33.1064, lng: -96.8028 },
  { name: 'Lowes Plano',                 lat: 33.0534, lng: -96.6983 },
  { name: 'Lowes Denton',                lat: 33.1969, lng: -97.0903 },
  { name: 'Lowes Lewisville',            lat: 33.0575, lng: -97.0154 },
  { name: 'Lowes Flower Mound',          lat: 33.0710, lng: -97.0810 },
  { name: 'Lock N Roll Storage CStat',    lat: 30.6326484, lng: -96.3017319 },
  { name: 'Home Depot Brenham',           lat: 30.1396086, lng: -96.3899173 },
  { name: 'Home Depot Austin Lakeline',  lat: 30.4770023, lng: -97.7987743 },
  { name: 'Home Depot Austin Lakeline',  lat: 30.4782697, lng: -97.7988762 },
  { name: 'Home Depot Austin Lakeline',  lat: 30.478351,  lng: -97.799633  },
  { name: 'Home Depot Austin Lakeline',  lat: 30.478425,  lng: -97.797916  },
  { name: 'Home Depot Austin Lakeline',  lat: 30.478952,  lng: -97.799037  },
  { name: 'Home Depot Austin S I-35',     lat: 30.2221031, lng: -97.7495362 },
  { name: 'Home Depot Austin Barbara Jordan', lat: 30.3077956, lng: -97.7098452 },
  { name: 'Home Depot Austin N Mopac',    lat: 30.3934426, lng: -97.7317976 },
  { name: 'Home Depot OKC S Shields',     lat: 35.393434,  lng: -97.5044463 },
  { name: 'Home Depot OKC W Reno',        lat: 35.4635096, lng: -97.6317504 },
  { name: 'Home Depot OKC NW 59th',       lat: 35.5312716, lng: -97.5695585 },
  { name: 'Lowes College Station',        lat: 30.562449,  lng: -96.257062  },
  { name: 'Lowes Bryan',                  lat: 30.658349,  lng: -96.326184  },
  { name: 'Lowes Brenham',                lat: 30.140455,  lng: -96.398038  },
  { name: 'Lowes Austin Shoal Creek',     lat: 30.3656,    lng: -97.74030   },
  { name: 'Lowes Austin N I-35',          lat: 30.415364,  lng: -97.675614  },
  { name: 'Lowes Austin S I-35',          lat: 30.200783,  lng: -97.764880  },
  { name: 'Lowes OKC I-240',              lat: 35.389025,  lng: -97.514252  },
  { name: 'Lowes OKC N May',              lat: 35.510004,  lng: -97.567623  },
  { name: 'Lowes OKC W Memorial',         lat: 35.606458,  lng: -97.556346  },
];

function miles(a:number,b:number,c:number,d:number){const R=3958.8,r=(x:number)=>x*Math.PI/180;const dLat=r(c-a),dLng=r(d-b);const h=Math.sin(dLat/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dLng/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
const OFFICE_RADIUS=0.3;
function matchBiz(lat:number,lng:number){if(lat==null||lng==null||isNaN(lat))return null;let best:any=null,bd=Infinity;for(const b of BUSINESS_LOCATIONS){const d=miles(lat,lng,b.lat,b.lng);if(d<bd){bd=d;best=b;}}return best&&bd<=OFFICE_RADIUS?{name:best.name,dist:+bd.toFixed(3)}:null;}
const parse=(s:string)=>new Date(String(s).replace(' ','T')+'Z').getTime();
const toCST=(s:string)=>{if(!s)return null;const d=new Date(parse(s)+2*3600*1000);return d.toISOString().replace('T',' ').slice(0,19);};

export async function GET(req:NextRequest){
  const sp=req.nextUrl.searchParams;
  if(sp.get('token')!=='critterstop2026')return NextResponse.json({error:'Unauthorized'},{status:401});
  const empId=sp.get('empId')||'10822';
  const from=sp.get('from')||'2026-11-09',to=sp.get('to')||'2026-11-15';
  // find office
  let cfg:any=null;
  for(const [office,c] of Object.entries(FR_OFFICES)){if(!c.key)continue;const auth=`authenticationKey=${c.key}&authenticationToken=${c.token}`;const j=await (await fetch(`${FR_BASE}/employee/get?employeeIDs=${empId}&${auth}`)).json().catch(()=>null);if(j?.employees?.length){cfg={...c,office,name:`${j.employees[0].fname} ${j.employees[0].lname}`};break;}}
  if(!cfg)return NextResponse.json({error:'not found'},{status:404});
  const auth=`authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;

  const days:any[]=[];
  const start=new Date(from+'T00:00:00Z'),endD=new Date(to+'T00:00:00Z');
  for(let d=new Date(start);d<=endD;d.setUTCDate(d.getUTCDate()+1)){
    const date=d.toISOString().slice(0,10);
    const s=`${date} 00:00:00`,e=`${date} 23:59:59`;

    // his own GPS
    const locJson=await (await fetch(`${FR_BASE}/employeeLocation/search?employeeID=${encodeURIComponent(JSON.stringify({operator:'=',value:empId}))}&time=${encodeURIComponent(JSON.stringify({operator:'BETWEEN',value:[s,e]}))}&includeData=1&${auth}`)).json().catch(()=>null);
    let locs=locJson?.employeeLocations||[];
    if(!locs.length&&(locJson?.employeeLocationIDs||[]).length){const g=await fetch(`${FR_BASE}/employeeLocation/get?employeeLocationIDs=${locJson.employeeLocationIDs.slice(0,600).join(',')}&${auth}`);locs=(await g.json().catch(()=>null))?.employeeLocations||[];}
    locs=locs.filter((l:any)=>String(l.employeeID)===empId).sort((a:any,b:any)=>String(a.time).localeCompare(String(b.time)));

    // find routes where he is additionalTech or assignedTech
    const rtS=await (await fetch(`${FR_BASE}/route/search?date=${encodeURIComponent(JSON.stringify({operator:'=',value:date}))}&${auth}`)).json().catch(()=>null);
    const rtIds=(rtS?.routeIDs||[]).slice(0,80);
    let routes:any[]=[];
    if(rtIds.length){const g=await fetch(`${FR_BASE}/route/get?routeIDs=${rtIds.join(',')}&${auth}`);routes=(await g.json().catch(()=>null))?.routes||[];}
    const myRoutes=routes.filter((r:any)=>{const add=(r.additionalTechs||'').split(',').map((x:string)=>x.trim());return add.includes(empId)||String(r.assignedTech)===empId;});
    const mainTechs=[...new Set(myRoutes.map((r:any)=>String(r.assignedTech)))];

    // appointments of the main tech(s) for the day (his stops)
    let appts:any[]=[];
    for(const mt of mainTechs){
      const apJson=await (await fetch(`${FR_BASE}/appointment/search?date=${encodeURIComponent(JSON.stringify({operator:'=',value:date}))}&servicedBy=${mt}&includeData=1&${auth}`)).json().catch(()=>null);
      let a=apJson?.appointments||[];
      if(!a.length&&(apJson?.appointmentIDs||[]).length){const g=await fetch(`${FR_BASE}/appointment/get?appointmentIDs=${apJson.appointmentIDs.slice(0,50).join(',')}&${auth}`);a=(await g.json().catch(()=>null))?.appointments||[];}
      appts=appts.concat(a);
    }
    const stops=appts.filter((a:any)=>a.checkIn||a.timeIn).map((a:any)=>({time:a.checkIn||a.timeIn,outTime:a.checkOut||a.timeOut,lat:+a.latIn,lng:+a.longIn})).sort((x,y)=>String(x.time).localeCompare(String(y.time)));

    // RULE ENGINE (no own clock punch for additional tech): use own GPS + route stops
    const flags:string[]=['No clock-in','No clock-out']; // additional techs have no punches
    // effective in = earliest of: first GPS at business loc, first route stop
    let firstBizGps:any=null;
    for(const l of locs){const m=matchBiz(+l.latitude,+l.longitude);if(m){firstBizGps={time:l.time,loc:m.name};break;}}
    const firstStop=stops[0]||null;
    const inC:any[]=[];
    if(firstBizGps)inC.push({t:firstBizGps.time,src:`GPS @ ${firstBizGps.loc}`});
    if(firstStop){const m=matchBiz(firstStop.lat,firstStop.lng);inC.push({t:firstStop.time,src:`route stop${m?' @ '+m.name:' (customer)'}`});}
    inC.sort((a,b)=>String(a.t).localeCompare(String(b.t)));
    const effIn=inC[0]?.t||null,effInSrc=inC[0]?.src||'';

    // effective out = latest of: last GPS at business loc, last route stop departure
    let lastBizGps:any=null;
    for(let i=locs.length-1;i>=0;i--){const m=matchBiz(+locs[i].latitude,+locs[i].longitude);if(m){lastBizGps={time:locs[i].time,loc:m.name};break;}}
    const lastStop=stops[stops.length-1]||null;
    const outC:any[]=[];
    if(lastBizGps)outC.push({t:lastBizGps.time,src:`GPS @ ${lastBizGps.loc}`});
    if(lastStop)outC.push({t:lastStop.outTime||lastStop.time,src:'last route stop'});
    outC.sort((a,b)=>String(b.t).localeCompare(String(a.t)));
    const effOut=outC[0]?.t||null,effOutSrc=outC[0]?.src||'';

    const hours=(effIn&&effOut)?+(((parse(effOut)-parse(effIn))/3600000)).toFixed(2):null;
    const worked=!!(locs.length||stops.length);
    days.push({date,worked,effectiveIn:toCST(effIn),effectiveInSource:effInSrc,effectiveOut:toCST(effOut),effectiveOutSource:effOutSrc,hours,ownGps:locs.length,routeStops:stops.length,ridingWith:mainTechs,flags:worked?flags:['Did not work']});
  }
  const totalHours=days.reduce((a,d)=>a+(d.hours||0),0);
  const daysWorked=days.filter(d=>d.worked).length;
  return NextResponse.json({employee:cfg.name,office:cfg.office,from,to,daysWorked,totalHours:+totalHours.toFixed(2),days});
}
