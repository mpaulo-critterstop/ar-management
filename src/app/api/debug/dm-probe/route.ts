import { NextRequest, NextResponse } from 'next/server';
import { FR_OFFICES } from '@/lib/helcimBridge';
export const dynamic='force-dynamic'; export const maxDuration=120;
const FR_BASE='https://critterstoppest.fieldroutes.com/api';
const SL_BASE='https://api.smarterlaunch.com/api/v1';
export async function GET(req:NextRequest){
  const sp=req.nextUrl.searchParams;
  if(sp.get('token')!=='critterstop2026')return NextResponse.json({error:'Unauthorized'},{status:401});
  const custId=sp.get('custId')||'52568';
  const out:any={custId};
  // 1) FR customer record
  let cfg:any=null;
  for(const [office,c] of Object.entries(FR_OFFICES)){if(!c.key)continue;const auth=`authenticationKey=${c.key}&authenticationToken=${c.token}`;const j=await (await fetch(`${FR_BASE}/customer/get?customerIDs=${custId},${custId}&${auth}`)).json().catch(()=>null);if(j?.customers?.length){cfg={...c,office};out.frCustomer={name:`${j.customers[0].fname} ${j.customers[0].lname}`,email:j.customers[0].email,phone:j.customers[0].phone1,address:j.customers[0].address,city:j.customers[0].city};break;}}
  if(!cfg)return NextResponse.json({error:'FR customer not found',...out},{status:404});
  const auth=`authenticationKey=${cfg.key}&authenticationToken=${cfg.token}`;
  out.office=cfg.office;

  // 2) FR appointments for this customer — find exclusion (type 553) + any 533/504
  const asj=await (await fetch(`${FR_BASE}/appointment/search?customerIDs=${custId}&${auth}`)).json().catch(()=>null);
  const aids=(asj?.appointmentIDs||[]).slice(0,50);
  let appts:any[]=[];
  if(aids.length){const g=await (await fetch(`${FR_BASE}/appointment/get?appointmentIDs=${aids.join(',')}${aids.length===1?','+aids[0]:''}&${auth}`)).json().catch(()=>null);appts=g?.appointments||[];}
  out.appointments=appts.map((a:any)=>({id:a.appointmentID,date:a.date,type:a.type,serviceID:a.serviceID,status:a.status,statusText:a.statusText,dateCompleted:a.dateCompleted,subscriptionID:a.subscriptionID,duration:a.duration})).sort((x:any,y:any)=>String(x.date).localeCompare(String(y.date)));
  // highlight exclusion appointments (type/serviceID 553)
  out.exclusionAppointments=out.appointments.filter((a:any)=>String(a.type)==='553'||String(a.serviceID)==='553');

  // 3) existing subscriptions for this customer
  const ssj=await (await fetch(`${FR_BASE}/subscription/search?customerIDs=${custId}&${auth}`)).json().catch(()=>null);
  const sids=(ssj?.subscriptionIDs||[]).slice(0,30);
  let subs:any[]=[];
  if(sids.length){const g=await (await fetch(`${FR_BASE}/subscription/get?subscriptionIDs=${sids.join(',')}${sids.length===1?','+sids[0]:''}&${auth}`)).json().catch(()=>null);subs=g?.subscriptions||[];}
  out.subscriptions=subs.map((s:any)=>({id:s.subscriptionID,serviceID:s.serviceID,serviceType:s.serviceType,active:s.active,frequency:s.frequency,nextService:s.nextService}));

  // 4) SmarterLaunch proposal — need customer_uuid. FR customer may not hold it; try SL search by email.
  const KEY=process.env.SMARTERLAUNCH_API_KEY;
  if(KEY && out.frCustomer?.email){
    const h={'X-API-Key':KEY,'Accept':'application/json'};
    // SL: find customer by email, then proposals
    const cs=await (await fetch(`${SL_BASE}/customers?email=${encodeURIComponent(out.frCustomer.email)}`,{headers:h})).json().catch(()=>null);
    out.slCustomerSearch=cs?.data?cs.data.map((c:any)=>({uuid:c.uuid,name:`${c.first_name||''} ${c.last_name||''}`,email:c.email})):cs;
    const uuid=cs?.data?.[0]?.uuid;
    if(uuid){
      const pr=await (await fetch(`${SL_BASE}/proposals?customer_uuid=${uuid}`,{headers:h})).json().catch(()=>null);
      out.slProposals=(pr?.data||[]).map((p:any)=>({uuid:p.uuid,title:p.proposal_template_title,status:p.status?.status_code,accepted:p.accepted_at||p.date_accepted}));
      const accepted=(pr?.data||[]).find((p:any)=>p.status?.status_code==='PROPOSAL_ACCEPTED')||(pr?.data||[])[0];
      if(accepted){
        const det=await (await fetch(`${SL_BASE}/proposals/${accepted.uuid}`,{headers:h})).json().catch(()=>null);
        const d=det?.data||{};
        const pv=d.latest_version?.proposal_values||{}; const pgv=pv.pricingGroupValues||{};
        const nameByUuid:Record<string,string>={};
        (function walk(o:any){if(o&&typeof o==='object'){if(o.uuid&&o.name&&typeof o.uuid==='string'&&o.uuid.length===36&&!(o.uuid in nameByUuid))nameByUuid[o.uuid]=o.name;for(const v of Object.values(o))walk(v);}})(d);
        const isSel=(v:any)=>v===true||(typeof v==='number'&&v>0)||(typeof v==='string'&&v.trim()!==''&&v.trim()!=='0');
        const selected:any={}; const guaranteeGroups:any={};
        for(const [uuid,qty] of Object.entries(pgv)){const nm=nameByUuid[uuid]||uuid; if(isSel(qty))selected[nm]=qty; if(String(nm).toLowerCase().includes('guarantee')||String(nm).toLowerCase().includes('warranty')||String(nm).toLowerCase().includes('year'))guaranteeGroups[nm]=qty;}
        out.proposalDetail={uuid:accepted.uuid,title:d.proposal_template_title,tags:(d.tags||[]).map((t:any)=>t.name),selectedGroups:selected,guaranteeRelatedGroups:guaranteeGroups};
      }
    }
  } else {
    out.slNote=KEY?'no email to look up SL':'SMARTERLAUNCH_API_KEY not set';
  }
  return NextResponse.json(out);
}
