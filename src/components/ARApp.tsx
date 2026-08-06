// v2
"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { LastSynced } from "@/components/LastSynced";

const ACCENT = '#0052cc';
const TODAY = new Date();

const fmt = (n: number) => "$" + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => Math.round(n * 100) + "%";
const daysDiff = (ds: string) => Math.round((TODAY.getTime() - new Date(ds).getTime()) / 86400000);

const statusLabels: Record<string, string> = {
  CURRENT:"Current", OVERDUE:"Overdue", COLLECTIONS:"Collections", PAID:"Paid",
  PAYMENT_PLAN:"Payment Plan", DISPUTED:"Disputed", SUSPENDED:"Suspended", ACTIVE:"Active"
};

const BB: Record<string, {bg:string,c:string}> = {
  CURRENT:{bg:"#E1F5EE",c:"#085041"}, OVERDUE:{bg:"#FAEEDA",c:"#633806"},
  COLLECTIONS:{bg:"#FCEBEB",c:"#791F1F"}, PAID:{bg:"#F1EFE8",c:"#444441"},
  PAYMENT_PLAN:{bg:"#E6F1FB",c:"#0C447C"}, DISPUTED:{bg:"#FBEAF0",c:"#72243E"},
  SUSPENDED:{bg:"#F1EFE8",c:"#444441"}, ACTIVE:{bg:"#E1F5EE",c:"#085041"},
};

const Badge = ({status, label:lbl, small}: {status:string, label?:string, small?:boolean}) => {
  const s = BB[status] || {bg:"#eee",c:"#333"};
  const text = lbl || statusLabels[status] || status;
  return <span style={{display:"inline-block",fontSize:small?11:12,fontWeight:500,padding:small?"2px 7px":"3px 9px",borderRadius:99,background:s.bg,color:s.c,whiteSpace:"nowrap"}}>{text}</span>;
};

const MC = ({label,value,sub,color,clickable,selected,onClick}: {label:string,value:string|number,sub?:string,color?:string,clickable?:boolean,selected?:boolean,onClick?:()=>void}) => (
  <div
    onClick={onClick}
    style={{
      background: "#fff",
      borderRadius:12, padding:"14px 18px",
      border: selected ? `1.5px solid ${ACCENT}` : "0.5px solid #E8E7E3",
      borderLeft: `3px solid ${color || ACCENT}`,
      cursor: clickable ? "pointer" : "default",
      transition: "box-shadow 0.15s",
    }}
  >
    <div style={{fontSize:11,color:"#888780",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{label}</div>
    <div style={{fontSize:24,fontWeight:500,color:color||"#2C2C2A"}}>{value}</div>
    {sub && <div style={{fontSize:11,color:"#B4B2A9",marginTop:2}}>{sub}</div>}
  </div>
);

const Card = ({title,action,children,noPad}: {title?:string,action?:React.ReactNode,children:React.ReactNode,noPad?:boolean}) => (
  <div style={{background:"#fff",border:"0.5px solid #E8E7E3",borderRadius:12,padding:noPad?0:"1rem 1.25rem",marginBottom:"1rem",overflow:"hidden"}}>
    {title && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:noPad?0:"1rem",padding:noPad?"1rem 1.25rem 0.75rem":0,borderBottom:noPad?"0.5px solid #E8E7E3":"none"}}>
      <span style={{fontSize:14,fontWeight:500}}>{title}</span>{action}
    </div>}
    {children}
  </div>
);

const Th = ({children,right}: {children:React.ReactNode,right?:boolean}) => (
  <th style={{textAlign:right?"right":"left",fontSize:11,fontWeight:500,color:"#888780",padding:"8px 12px",borderBottom:"0.5px solid #E8E7E3",whiteSpace:"nowrap",background:"#F8F7F4"}}>{children}</th>
);
const Td = ({children,right,bold,color,style:s}: {children?:React.ReactNode,right?:boolean,bold?:boolean,color?:string,style?:React.CSSProperties}) => (
  <td style={{padding:"10px 12px",borderBottom:"0.5px solid #F1EFE8",textAlign:right?"right":"left",fontWeight:bold?500:400,fontSize:13,verticalAlign:"middle",color:color||"inherit",...s}}>{children}</td>
);
const Btn = ({children,onClick,primary,small,danger,disabled}: {children:React.ReactNode,onClick?:()=>void,primary?:boolean,small?:boolean,danger?:boolean,disabled?:boolean}) => (
  <button onClick={onClick} disabled={disabled} style={{background:primary?ACCENT:danger?"#FCEBEB":"#fff",color:primary?"#fff":danger?"#791F1F":"#2C2C2A",border:primary?"none":danger?"0.5px solid #F09595":"0.5px solid #D3D1C7",padding:small?"4px 10px":"7px 14px",borderRadius:8,cursor:disabled?"not-allowed":"pointer",fontSize:small?12:13,opacity:disabled?0.5:1,fontWeight:500,display:"inline-flex",alignItems:"center",gap:5}}>{children}</button>
);
const ER = ({cols,msg}: {cols:number,msg:string}) => (
  <tr><td colSpan={cols} style={{textAlign:"center",padding:"2rem",fontSize:13,color:"#888780"}}>{msg}</td></tr>
);
const Modal = ({title,onClose,children,wide}: {title:string,onClose:()=>void,children:React.ReactNode,wide?:boolean}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,border:"0.5px solid #D3D1C7",width:"100%",maxWidth:wide?700:520,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"1rem 1.25rem",borderBottom:"0.5px solid #E8E7E3",position:"sticky",top:0,background:"#fff",zIndex:1}}>
        <span style={{fontSize:15,fontWeight:500}}>{title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:22,color:"#888780",lineHeight:1}}>×</button>
      </div>
      <div style={{padding:"1.25rem"}}>{children}</div>
    </div>
  </div>
);
const Inp = ({label,value,onChange,type,placeholder,options,style:s,disabled}: {label?:string,value:string,onChange:(v:string)=>void,type?:string,placeholder?:string,options?:{value:string,label:string}[],style?:React.CSSProperties,disabled?:boolean}) => (
  <div style={{display:"flex",flexDirection:"column",gap:4,...s}}>
    {label && <label style={{fontSize:12,color:"#888780",fontWeight:500}}>{label}</label>}
    {options
      ? <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{fontSize:13,padding:"7px 10px",border:"0.5px solid #B4B2A9",borderRadius:8,background:"#fff"}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
      : <input type={type||"text"} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} style={{fontSize:13,padding:"7px 10px",border:"0.5px solid #B4B2A9",borderRadius:8}} />
    }
  </div>
);

const Pagination = ({current,total,pageSize,onPage,onSize}:any) => {
  const totalPages = Math.ceil(total/pageSize);
  const pageNums = () => {
    const pages:number[] = [];
    if(totalPages<=7){for(let i=1;i<=totalPages;i++)pages.push(i);}
    else{
      pages.push(1);
      if(current>3)pages.push(-1);
      for(let i=Math.max(2,current-1);i<=Math.min(totalPages-1,current+1);i++)pages.push(i);
      if(current<totalPages-2)pages.push(-1);
      pages.push(totalPages);
    }
    return pages;
  };
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderTop:"0.5px solid #E8E7E3",background:"#F8F7F4",flexWrap:"wrap",gap:8}}>
      <div style={{fontSize:12,color:"#888780"}}>
        Showing {total===0?0:(current-1)*pageSize+1}–{Math.min(current*pageSize,total)} of {total} &nbsp;
        <select value={pageSize} onChange={e=>{onSize(Number(e.target.value));}} style={{fontSize:12,padding:"2px 6px",border:"0.5px solid #B4B2A9",borderRadius:4}}>
          <option value={100}>100</option><option value={500}>500</option><option value={1000}>1000</option>
        </select> per page
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <button onClick={()=>onPage(Math.max(1,current-1))} disabled={current===1} style={{padding:"3px 10px",fontSize:12,border:"0.5px solid #D3D1C7",borderRadius:4,background:current===1?"#F8F7F4":"#fff",cursor:current===1?"not-allowed":"pointer"}}>Previous</button>
        {pageNums().map((p,i)=>p===-1
          ?<span key={i} style={{padding:"3px 6px",fontSize:12}}>…</span>
          :<button key={p} onClick={()=>onPage(p)} style={{padding:"3px 10px",fontSize:12,border:"0.5px solid #D3D1C7",borderRadius:4,background:current===p?ACCENT:"#fff",color:current===p?"#fff":"#2C2C2A",cursor:"pointer"}}>{p}</button>
        )}
        <button onClick={()=>onPage(Math.min(totalPages,current+1))} disabled={current===totalPages} style={{padding:"3px 10px",fontSize:12,border:"0.5px solid #D3D1C7",borderRadius:4,background:current===totalPages?"#F8F7F4":"#fff",cursor:current===totalPages?"not-allowed":"pointer"}}>Next</button>
      </div>
    </div>
  );
};

export default function ARApp() {
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState<any>(null);
  const [toast, setToast] = useState<{msg:string,type:string}|null>(null);
  const [customers, setCustomersState] = useState<any[]>([]);
  const [invoices, setInvoicesState] = useState<any[]>([]);
  const [payments, setPaymentsState] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [officeFilter, setOfficeFilter] = useState("ALL");
  const [collectedDays, setCollectedDays] = useState(30);
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');

  const showToast = useCallback((msg:string, type="success") => {
    setToast({msg,type}); setTimeout(()=>setToast(null),3000);
  },[]);

  async function loadAll(office?: string) {
    setLoading(true);
    const o = office || officeFilter;
    const oq = o !== "ALL" ? `?office=${o}` : "";
    try {
      const [c,i,p] = await Promise.all([
        fetch(`/api/customers${oq}`).then(r=>r.json()),
        fetch(`/api/invoices${oq}`).then(r=>r.json()),
        fetch(`/api/payments?days=365${o !== "ALL" ? `&office=${o}` : ""}`).then(r=>r.json()),
      ]);
      setCustomersState(Array.isArray(c)?c:[]);
      setInvoicesState(Array.isArray(i)?i:[]);
      setPaymentsState(Array.isArray(p)?p:[]);
    } catch(e) { showToast("Failed to load data","error"); }
    setLoading(false);
  }



  useEffect(()=>{ loadAll(); },[]);

  const custMap = useMemo(()=>Object.fromEntries(customers.map((c:any)=>[c.id,c])),[customers]);
  const enriched = useMemo(()=>invoices.map((inv:any)=>({
    ...inv,
    customer: custMap[inv.customerId],
    balance: Number(inv.amount)-Number(inv.paid),
    daysOverdue: inv.due ? Math.max(0, daysDiff(inv.due)) : 0,
    daysOld: daysDiff(inv.date),
  })),[invoices,custMap]);
  const open = useMemo(()=>enriched.filter((i:any)=>i.status!=="PAID"),[enriched]);
  const totalAR = open.reduce((s:number,i:any)=>s+i.balance,0);
  const totalOverdue = open.filter((i:any)=>["OVERDUE","COLLECTIONS"].includes(i.status)&&i.due).reduce((s:number,i:any)=>s+i.balance,0);
  const collected = payments.filter((p:any)=>{
    if(collectedDays===0){
      if(!customDateFrom||!customDateTo) return false;
      const d=new Date(p.date);
      return d>=new Date(customDateFrom) && d<=new Date(customDateTo);
    }
    return daysDiff(p.date)<=collectedDays;
  }).reduce((s:number,p:any)=>s+Number(p.amount),0);

  const agingTotals = useMemo(()=>{
    const t:{[k:string]:number}={current:0,"1-30":0,"31-60":0,"61-90":0,"90+":0};
    open.forEach((i:any)=>{
      const d=i.daysOverdue;
      const b=d<=0?"current":d<=30?"1-30":d<=60?"31-60":d<=90?"61-90":"90+";
      t[b]+=i.balance;
    });
    return t;
  },[open]);

  const prevMonthAR = useMemo(()=>{
    const now = new Date();
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonthPayments = payments.filter((p:any)=>new Date(p.date)>=firstThisMonth).reduce((s:number,p:any)=>s+Number(p.amount),0);
    return totalAR + thisMonthPayments;
  },[totalAR, payments]);

  const PAGES = [
    {id:"dashboard",label:"Dashboard"},
    {id:"callsheet",label:"Call Sheet"},
    {id:"blitz",label:"AR Blitz"},
    {id:"stages",label:"Collections / SCC / Bad Debt"},
    {id:"customers",label:"Customers"},
    {id:"invoices",label:"Invoices"},
    {id:"payments",label:"Payments"},
    {id:"aging",label:"Aging"},
  ];

  if(loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,fontSize:13,color:"#888780"}}>Loading AR data…</div>;

  const shared = {customers,invoices,payments,custMap,enriched,open,setModal,showToast,loadAll,officeFilter};

  return (
    <div style={{padding:"0 24px 24px",maxWidth:1200,margin:"0 auto"}}>
      {toast && <div style={{position:"fixed",top:16,right:16,zIndex:2000,background:toast.type==="error"?"#FCEBEB":"#E1F5EE",color:toast.type==="error"?"#791F1F":"#085041",border:`0.5px solid ${toast.type==="error"?"#F09595":"#5DCAA5"}`,borderRadius:8,padding:"10px 16px",fontSize:13,fontWeight:500}}>{toast.msg}</div>}

      {/* Title */}
      <div style={{paddingTop:24,marginBottom:4}}>
        <h1 style={{fontSize:20,fontWeight:500,color:"#2C2C2A",margin:0}}>Accounts Receivable</h1>
      </div>

      {/* Sub-nav + office selector */}
      <div style={{display:"flex",gap:8,marginBottom:"1.5rem",alignItems:"center",justifyContent:"space-between",paddingTop:20,flexWrap:"wrap"}}>
        <div style={{display:"inline-flex",alignItems:"center",gap:2,padding:4,borderRadius:12,background:"#F1EFE8",border:"0.5px solid #E8E7E3"}}>
          {PAGES.map(p=>(
            <button key={p.id} onClick={()=>setPage(p.id)} style={{padding:"7px 14px",borderRadius:9,fontSize:13,fontWeight:500,color:page===p.id?"#2C2C2A":"#888780",background:page===p.id?"#ffffff":"transparent",border:page===p.id?"0.5px solid #D3D1C7":"0.5px solid transparent",boxShadow:page===p.id?"0 1px 3px rgba(44,44,42,0.08)":"none",cursor:"pointer",whiteSpace:"nowrap"}}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:2,padding:4,borderRadius:12,background:"#F1EFE8",border:"0.5px solid #E8E7E3"}}>
            {["ALL","DFW","ATX","OKC","CStat"].map(o=>(
              <button key={o} onClick={()=>{setOfficeFilter(o);loadAll(o);}} style={{padding:"7px 14px",borderRadius:9,fontSize:13,fontWeight:500,color:officeFilter===o?"#2C2C2A":"#888780",background:officeFilter===o?"#ffffff":"transparent",border:officeFilter===o?"0.5px solid #D3D1C7":"0.5px solid transparent",boxShadow:officeFilter===o?"0 1px 3px rgba(44,44,42,0.08)":"none",cursor:"pointer"}}>
                {o==="ALL"?"All":o}
              </button>
            ))}
          </div>
          <LastSynced office={officeFilter} />
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {page==="dashboard" && <DashPage {...shared} totalAR={totalAR} totalOverdue={totalOverdue} collected={collected} agingTotals={agingTotals} collectedDays={collectedDays} setCollectedDays={setCollectedDays} customDateFrom={customDateFrom} customDateTo={customDateTo} setCustomDateFrom={setCustomDateFrom} setCustomDateTo={setCustomDateTo} prevMonthAR={prevMonthAR} />}
      {page==="callsheet" && <CallSheetPage officeFilter={officeFilter} showToast={showToast} />}
      {page==="blitz" && <BlitzPage officeFilter={officeFilter} showToast={showToast} />}
      {page==="stages" && <StagesPage officeFilter={officeFilter} showToast={showToast} />}
      {page==="customers" && <CustPage {...shared} />}
      {page==="invoices" && <InvPage {...shared} />}
      {page==="payments" && <PayPage {...shared} />}
      {page==="aging" && <AgePage {...shared} agingTotals={agingTotals} />}

      {modal?.type==="editInvoice" && <InvModal {...shared} invoice={modal.invoice} onClose={()=>setModal(null)} />}
      {modal?.type==="recordPayment" && <PayModal {...shared} invoice={modal.invoice} onClose={()=>setModal(null)} />}
      {modal==="newPayment" && <PayModal {...shared} invoice={null} onClose={()=>setModal(null)} />}
      {modal?.type==="closeOut" && <CloseOutModal {...shared} invoice={modal.invoice} onClose={()=>setModal(null)} />}
      {modal?.type==="customerDetail" && <CustDetail {...shared} customer={modal.customer} onClose={()=>setModal(null)} />}
    </div>
  );
}

function CallSheetPage({officeFilter, showToast}: any) {
  const [data, setData] = useState<any>(null);
  const [loadingCS, setLoadingCS] = useState(true);
  const [callModal, setCallModal] = useState<any>(null);
  const [moveModal, setMoveModal] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [svcFilter, setSvcFilter] = useState<"all"|"Pest Control"|"Wildlife">("all");
  const [noteEdits, setNoteEdits] = useState<Record<string,string>>({});
  const [savingNote, setSavingNote] = useState<string|null>(null);

  const load = useCallback(() => {
    setLoadingCS(true);
    fetch(`/api/ar/call-sheet?office=${officeFilter||'All'}`)
      .then(r=>r.json()).then(d=>{setData(d);setLoadingCS(false);})
      .catch(()=>{setLoadingCS(false);});
  },[officeFilter]);
  useEffect(()=>{ load(); },[load]);

  const money=(n:number)=>'$'+Math.round(n).toLocaleString();
  const fmtDate=(d:string)=>new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

  const saveNote=async(invoiceId:string)=>{
    setSavingNote(invoiceId);
    await fetch('/api/ar/call-sheet',{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({invoiceId,arNote:noteEdits[invoiceId]??''})});
    setSavingNote(null);
    showToast&&showToast("Note saved");
  };

  if(loadingCS) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"#888780"}}>Loading call sheet…</div>;

  const allItems = data?.items||[];
  const items = allItems.filter((it:any)=>{
    const matchSearch = !search.trim() || (it.customerName||'').toLowerCase().includes(search.toLowerCase());
    const matchSvc = svcFilter==="all" || it.serviceCategory===svcFilter;
    return matchSearch && matchSvc;
  });

  return (
    <div>
      <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:600,color:"#2C2C2A"}}>Today&apos;s Call Sheet</div>
        <div style={{fontSize:13,color:"#888780"}}>{items.length} to call{allItems.length===0?" — all caught up 🎉":""}</div>
      </div>

      {/* Search + service filter */}
      <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer…"
          style={{padding:"7px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #D3D1C7",minWidth:220}} />
        <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#F1EFE8",border:"0.5px solid #E8E7E3"}}>
          {(["all","Pest Control","Wildlife"] as const).map(s=>(
            <button key={s} onClick={()=>setSvcFilter(s)} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:svcFilter===s?"0.5px solid #D3D1C7":"0.5px solid transparent",background:svcFilter===s?"#fff":"transparent",color:svcFilter===s?"#2C2C2A":"#888780"}}>
              {s==="all"?"All Services":s}
            </button>
          ))}
        </div>
      </div>

      {items.length>0 ? (
        <div style={{background:"#fff",borderRadius:12,border:"0.5px solid #E8E7E3",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{color:"#888780",textAlign:"left"}}>
                <th style={{padding:"10px 12px",fontWeight:500}}>Customer</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Service</th>
                <th style={{padding:"10px 12px",fontWeight:500,textAlign:"right"}}>Outstanding</th>
                <th style={{padding:"10px 12px",fontWeight:500,textAlign:"right"}}>Overdue</th>
                <th style={{padding:"10px 12px",fontWeight:500,textAlign:"right"}}>Last Call</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Phone</th>
                <th style={{padding:"10px 12px",fontWeight:500,minWidth:180}}>Note</th>
                <th style={{padding:"10px 12px",fontWeight:500}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it:any)=>{
                const noteVal = noteEdits[it.invoiceId]!==undefined ? noteEdits[it.invoiceId] : it.arNote;
                const dirty = noteEdits[it.invoiceId]!==undefined && noteEdits[it.invoiceId]!==it.arNote;
                return (
                <tr key={it.invoiceId} style={{borderTop:"0.5px solid #F1EFE8"}}>
                  <td style={{padding:"10px 12px",fontWeight:500,color:"#2C2C2A"}}>
                    {it.customerName}
                    <div style={{fontSize:11,color:"#B4B2A9"}}>{it.serviceAddr||""}</div>
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <span style={{fontSize:11,padding:"2px 7px",borderRadius:6,background:it.serviceCategory==="Wildlife"?"#E9F1E5":"#EAEEF6",color:it.serviceCategory==="Wildlife"?"#3F6B2E":"#2E4A79"}}>{it.serviceCategory}</span>
                  </td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:600,color:"#791F1F"}}>{money(it.outstanding)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right"}}>{it.daysOverdue}d</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#6B6A64"}}>{it.daysSinceCall==null?<span style={{color:"#C9C7BE"}}>never</span>:`${it.daysSinceCall}d`}</td>
                  <td style={{padding:"10px 12px",color:"#6B6A64"}}>{it.phone||"—"}</td>
                  <td style={{padding:"8px 12px"}}>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <input value={noteVal} onChange={e=>setNoteEdits(p=>({...p,[it.invoiceId]:e.target.value}))}
                        placeholder="Add note…" style={{flex:1,padding:"5px 8px",fontSize:12,borderRadius:6,border:"0.5px solid #D3D1C7",minWidth:120}} />
                      {dirty && <button onClick={()=>saveNote(it.invoiceId)} disabled={savingNote===it.invoiceId} style={{padding:"5px 8px",fontSize:11,borderRadius:6,border:"none",background:"#0052cc",color:"#fff",cursor:"pointer"}}>{savingNote===it.invoiceId?"…":"Save"}</button>}
                    </div>
                    {it.lastNote && <div style={{fontSize:10,color:"#B4B2A9",marginTop:3}} title={it.lastNote.text}>Last: {it.lastNote.text.slice(0,30)}{it.lastNote.text.length>30?"…":""} ({fmtDate(it.lastNote.date)})</div>}
                  </td>
                  <td style={{padding:"10px 12px"}}>
                    <div style={{display:"flex",gap:6,whiteSpace:"nowrap"}}>
                      <button onClick={()=>setCallModal(it)} style={{background:"#0052cc",color:"#fff",border:"none",padding:"5px 12px",borderRadius:7,fontSize:12,fontWeight:500,cursor:"pointer"}}>Mark Called</button>
                      <button onClick={()=>setMoveModal(it)} style={{background:"#fff",color:"#791F1F",border:"0.5px solid #D3B0B0",padding:"5px 12px",borderRadius:7,fontSize:12,fontWeight:500,cursor:"pointer"}}>Move To</button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{padding:40,textAlign:"center",fontSize:13,color:"#888780",background:"#fff",borderRadius:12,border:"0.5px solid #E8E7E3"}}>
          {allItems.length===0?"No invoices due for a call today.":"No matches for the current search/filter."}
        </div>
      )}

      {callModal && <MarkCalledModal item={callModal} onClose={()=>setCallModal(null)} onSaved={()=>{setCallModal(null);load();showToast&&showToast("Call logged");}} />}
      {moveModal && <MoveToModal item={moveModal} onClose={()=>setMoveModal(null)} onMoved={()=>{setMoveModal(null);load();showToast&&showToast("Moved off call sheet");}} />}
    </div>
  );
}

function MarkCalledModal({item, onClose, onSaved}: any) {
  const [text,setText]=useState("");
  const [status,setStatus]=useState("SPOKE");
  const [promisedAmount,setPromisedAmount]=useState("");
  const [promisedDate,setPromisedDate]=useState("");
  const [saving,setSaving]=useState(false);
  const OUTCOMES=[["SPOKE","Spoke with customer"],["LEFT_VOICEMAIL","Left voicemail"],["NO_CONTACT","No answer"],["PAYMENT_PROMISED","Promised payment"],["DISPUTED","Disputed"],["ESCALATED","Escalated"]];

  const save=async()=>{
    if(!text.trim()){return;}
    setSaving(true);
    const res=await fetch('/api/ar/call-sheet',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({invoiceId:item.invoiceId,customerId:item.customerId,text:text.trim(),status,
        promisedAmount:promisedAmount?parseFloat(promisedAmount):undefined,promisedDate:promisedDate||undefined})});
    setSaving(false);
    if(res.ok) onSaved();
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:460,padding:24}}>
        <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>Log call — {item.customerName}</div>
        <div style={{fontSize:12,color:"#888780",marginBottom:16}}>{item.serviceType||""} · ${Math.round(item.outstanding).toLocaleString()} outstanding · {item.daysOverdue}d overdue</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <label style={{fontSize:12,color:"#6B6A64"}}>Outcome
            <select value={status} onChange={e=>setStatus(e.target.value)} style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #D3D1C7",fontSize:13}}>
              {OUTCOMES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{fontSize:12,color:"#6B6A64"}}>Note
            <textarea value={text} onChange={e=>setText(e.target.value)} rows={3} placeholder="What happened on the call…" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #D3D1C7",fontSize:13,resize:"vertical"}} />
          </label>
          {status==="PAYMENT_PROMISED" && (
            <div style={{display:"flex",gap:10}}>
              <label style={{fontSize:12,color:"#6B6A64",flex:1}}>Promised $
                <input value={promisedAmount} onChange={e=>setPromisedAmount(e.target.value)} type="number" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #D3D1C7",fontSize:13}} />
              </label>
              <label style={{fontSize:12,color:"#6B6A64",flex:1}}>By date
                <input value={promisedDate} onChange={e=>setPromisedDate(e.target.value)} type="date" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #D3D1C7",fontSize:13}} />
              </label>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"0.5px solid #D3D1C7",background:"#fff",cursor:"pointer"}}>Cancel</button>
          <button onClick={save} disabled={saving||!text.trim()} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052cc",color:"#fff",fontWeight:500,cursor:"pointer",opacity:(saving||!text.trim())?0.6:1}}>{saving?"Saving…":"Log Call"}</button>
        </div>
      </div>
    </div>
  );
}

function MoveToModal({item, onClose, onMoved}: any) {
  const [stage,setStage]=useState<"COLLECTIONS"|"SCC"|"BAD_DEBT">("COLLECTIONS");
  const [note,setNote]=useState("");
  const [saving,setSaving]=useState(false);
  const STAGES=[["COLLECTIONS","Collections"],["SCC","SCC"],["BAD_DEBT","Bad Debt"]];

  const move=async()=>{
    setSaving(true);
    // set the stage; if a note was entered, save it to arNote too
    await fetch('/api/ar/call-sheet',{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({invoiceId:item.invoiceId,arStage:stage,...(note.trim()?{arNote:note.trim()}:{})})});
    setSaving(false);
    onMoved();
  };

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:420,padding:24}}>
        <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>Move — {item.customerName}</div>
        <div style={{fontSize:12,color:"#888780",marginBottom:16}}>${Math.round(item.outstanding).toLocaleString()} outstanding · removes from the call sheet</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <label style={{fontSize:12,color:"#6B6A64"}}>Move to
            <select value={stage} onChange={e=>setStage(e.target.value as any)} style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #D3D1C7",fontSize:13}}>
              {STAGES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{fontSize:12,color:"#6B6A64"}}>Note (optional)
            <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} placeholder="Reason for moving…" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #D3D1C7",fontSize:13,resize:"vertical"}} />
          </label>
        </div>
        <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"0.5px solid #D3D1C7",background:"#fff",cursor:"pointer"}}>Cancel</button>
          <button onClick={move} disabled={saving} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#791F1F",color:"#fff",fontWeight:500,cursor:"pointer",opacity:saving?0.6:1}}>{saving?"Moving…":"Move"}</button>
        </div>
      </div>
    </div>
  );
}

function BlitzPage({officeFilter, showToast}: any) {
  const [data,setData]=useState<any>(null);
  const [loadingB,setLoadingB]=useState(true);
  const [search,setSearch]=useState("");
  const [svcFilter,setSvcFilter]=useState<"all"|"Pest Control"|"Wildlife">("all");
  const [assigneeFilter,setAssigneeFilter]=useState<string>("all"); // 'all' | 'unassigned' | userId
  const [callModal,setCallModal]=useState<any>(null);
  const [savingAssign,setSavingAssign]=useState<string|null>(null);
  const [distModal,setDistModal]=useState(false);

  const load=useCallback(()=>{
    setLoadingB(true);
    const params=new URLSearchParams({office:officeFilter||'All'});
    if(assigneeFilter!=='all') params.set('assignee',assigneeFilter);
    fetch(`/api/ar/blitz?${params}`).then(r=>r.json()).then(d=>{setData(d);setLoadingB(false);}).catch(()=>setLoadingB(false));
  },[officeFilter,assigneeFilter]);
  useEffect(()=>{load();},[load]);

  const money=(n:number)=>'$'+Math.round(n).toLocaleString();
  const users=data?.assignableUsers||[];

  const assign=async(invoiceId:string,userId:string)=>{
    setSavingAssign(invoiceId);
    await fetch('/api/ar/blitz',{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({invoiceId,blitzAssignedTo:userId||null})});
    setSavingAssign(null);
    load();
  };

  if(loadingB) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"#888780"}}>Loading blitz backlog…</div>;

  const allItems=data?.items||[];
  const items=allItems.filter((it:any)=>{
    const ms=!search.trim()||(it.customerName||'').toLowerCase().includes(search.toLowerCase());
    const mv=svcFilter==="all"||it.serviceCategory===svcFilter;
    return ms&&mv;
  });
  const shownOutstanding=items.reduce((s:number,i:any)=>s+i.outstanding,0);

  return (
    <div>
      <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6}}>
        <div style={{fontSize:15,fontWeight:600,color:"#2C2C2A"}}>AR Blitz — Full Backlog</div>
        <div style={{fontSize:13,color:"#888780"}}>{items.length} invoices · {money(shownOutstanding)} outstanding</div>
      </div>
      <div style={{fontSize:12,color:"#B4B2A9",marginBottom:16}}>Every overdue invoice. Assign blocks to callers and work it down. (Separate from the regular cadence Call Sheet.)
        <button onClick={()=>setDistModal(true)} style={{marginLeft:12,padding:"5px 12px",fontSize:12,borderRadius:7,border:"0.5px solid #0052cc",background:"#fff",color:"#0052cc",fontWeight:500,cursor:"pointer"}}>Auto-distribute</button>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer…"
          style={{padding:"7px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #D3D1C7",minWidth:200}} />
        <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#F1EFE8",border:"0.5px solid #E8E7E3"}}>
          {(["all","Pest Control","Wildlife"] as const).map(s=>(
            <button key={s} onClick={()=>setSvcFilter(s)} style={{padding:"6px 10px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:svcFilter===s?"0.5px solid #D3D1C7":"0.5px solid transparent",background:svcFilter===s?"#fff":"transparent",color:svcFilter===s?"#2C2C2A":"#888780"}}>{s==="all"?"All":s}</button>
          ))}
        </div>
        <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} style={{padding:"7px 10px",fontSize:12,borderRadius:8,border:"0.5px solid #D3D1C7"}}>
          <option value="all">Everyone</option>
          <option value="unassigned">Unassigned</option>
          {users.map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {items.length>0 ? (
        <div style={{background:"#fff",borderRadius:12,border:"0.5px solid #E8E7E3",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{color:"#888780",textAlign:"left"}}>
                <th style={{padding:"10px 12px",fontWeight:500}}>Customer</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Service</th>
                <th style={{padding:"10px 12px",fontWeight:500,textAlign:"right"}}>Outstanding</th>
                <th style={{padding:"10px 12px",fontWeight:500,textAlign:"right"}}>Days Overdue</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Phone</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Assigned To</th>
                <th style={{padding:"10px 12px",fontWeight:500,minWidth:160}}>Note</th>
                <th style={{padding:"10px 12px",fontWeight:500}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it:any)=>(
                <tr key={it.invoiceId} style={{borderTop:"0.5px solid #F1EFE8"}}>
                  <td style={{padding:"10px 12px",fontWeight:500,color:"#2C2C2A"}}>{it.customerName}<div style={{fontSize:11,color:"#B4B2A9"}}>{it.serviceAddr||""}</div></td>
                  <td style={{padding:"10px 12px"}}><span style={{fontSize:11,padding:"2px 7px",borderRadius:6,background:it.serviceCategory==="Wildlife"?"#E9F1E5":"#EAEEF6",color:it.serviceCategory==="Wildlife"?"#3F6B2E":"#2E4A79"}}>{it.serviceCategory}</span></td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:600,color:"#791F1F"}}>{money(it.outstanding)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:it.daysOverdue>=90?"#791F1F":it.daysOverdue>=30?"#B45309":"#6B6A64"}}>{it.daysOverdue}d</td>
                  <td style={{padding:"10px 12px",color:"#6B6A64"}}>{it.phone||"—"}</td>
                  <td style={{padding:"8px 12px"}}>
                    <select value={it.assignedTo||""} onChange={e=>assign(it.invoiceId,e.target.value)} disabled={savingAssign===it.invoiceId}
                      style={{padding:"5px 8px",fontSize:12,borderRadius:6,border:"0.5px solid #D3D1C7",background:it.assignedTo?"#EAEEF6":"#fff",maxWidth:130}}>
                      <option value="">Unassigned</option>
                      {users.map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  <td style={{padding:"10px 12px",color:"#888780",maxWidth:180}}>
                    {it.arNote && <div style={{fontSize:11,color:"#6B6A64"}} title={it.arNote}>{it.arNote.slice(0,40)}{it.arNote.length>40?"…":""}</div>}
                    {it.lastNote && <div style={{fontSize:10,color:"#B4B2A9"}} title={it.lastNote.text}>Last call: {new Date(it.lastNote.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>}
                    {!it.arNote && !it.lastNote && <span style={{color:"#C9C7BE",fontSize:11}}>—</span>}
                  </td>
                  <td style={{padding:"10px 12px"}}><button onClick={()=>setCallModal(it)} style={{background:"#0052cc",color:"#fff",border:"none",padding:"5px 12px",borderRadius:7,fontSize:12,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>Mark Called</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{padding:40,textAlign:"center",fontSize:13,color:"#888780",background:"#fff",borderRadius:12,border:"0.5px solid #E8E7E3"}}>
          {allItems.length===0?"No overdue invoices. Backlog clear \uD83C\uDF89":"No matches for the current filters."}
        </div>
      )}

      {callModal && <MarkCalledModal item={callModal} onClose={()=>setCallModal(null)} onSaved={()=>{setCallModal(null);load();showToast&&showToast("Call logged");}} />}
      {distModal && <DistributeModal users={users} officeFilter={officeFilter} onClose={()=>setDistModal(false)} onDone={(res:any)=>{setDistModal(false);load();showToast&&showToast(`Distributed ${res.distributed} invoices`);}} />}
    </div>
  );
}

function DistributeModal({users, officeFilter, onClose, onDone}: any) {
  // Default roster = the 16 blitz callers (by username), matched against available AR users.
  const ROSTER_USERNAMES = ['mpaulo','lbueno','lcocjin','bnaco','mmarzon','crodriguez','nescobar','fcarreto','jpontillas','halaska','anavas','ecordova','vquebec','lcajas','gmiranda','vcarry'];
  const [selected,setSelected]=useState<Record<string,boolean>>(()=>{
    const m:Record<string,boolean>={};
    (users||[]).forEach((u:any)=>{ m[u.id]=true; }); // default: everyone assignable selected
    return m;
  });
  const [scope,setScope]=useState<"all"|"unassigned">("all");
  const [running,setRunning]=useState(false);
  const [result,setResult]=useState<any>(null);

  const chosen=(users||[]).filter((u:any)=>selected[u.id]);

  const run=async()=>{
    setRunning(true);
    const res=await fetch('/api/ar/blitz',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({userIds:chosen.map((u:any)=>u.id),office:officeFilter||'All',scope})});
    const data=await res.json();
    setRunning(false);
    if(res.ok){ setResult(data); }
    else { showToastFallback(data?.error); }
  };
  const showToastFallback=(msg:string)=>alert(msg||'Failed');

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:14,width:"100%",maxWidth:520,padding:24,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>Auto-distribute backlog</div>
        <div style={{fontSize:12,color:"#888780",marginBottom:16}}>Spreads the overdue backlog evenly across the selected people, balanced within each aging bucket (1-30 / 31-60 / 61-90 / 91-180 / 181+).</div>

        {!result ? (<>
          <div style={{fontSize:12,color:"#6B6A64",marginBottom:8}}>Scope</div>
          <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#F1EFE8",border:"0.5px solid #E8E7E3",marginBottom:16}}>
            <button onClick={()=>setScope("all")} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:scope==="all"?"0.5px solid #D3D1C7":"0.5px solid transparent",background:scope==="all"?"#fff":"transparent",color:scope==="all"?"#2C2C2A":"#888780"}}>Reshuffle all</button>
            <button onClick={()=>setScope("unassigned")} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:scope==="unassigned"?"0.5px solid #D3D1C7":"0.5px solid transparent",background:scope==="unassigned"?"#fff":"transparent",color:scope==="unassigned"?"#2C2C2A":"#888780"}}>Only unassigned</button>
          </div>

          <div style={{fontSize:12,color:"#6B6A64",marginBottom:8}}>People ({chosen.length} selected)</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:18}}>
            {(users||[]).map((u:any)=>(
              <label key={u.id} style={{display:"flex",alignItems:"center",gap:7,fontSize:13,padding:"5px 8px",borderRadius:7,background:selected[u.id]?"#EAEEF6":"#F7F6F3",cursor:"pointer"}}>
                <input type="checkbox" checked={!!selected[u.id]} onChange={e=>setSelected(p=>({...p,[u.id]:e.target.checked}))} />
                {u.name}
              </label>
            ))}
          </div>

          <div style={{background:"#FBF6E9",border:"0.5px solid #E8DCC0",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#8A6D1E",marginBottom:16}}>
            {scope==="all"?"Reshuffle all will reassign every invoice \u2014 including ones already assigned or in progress.":"Only unassigned will keep existing assignments and distribute the rest."}
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"0.5px solid #D3D1C7",background:"#fff",cursor:"pointer"}}>Cancel</button>
            <button onClick={run} disabled={running||chosen.length===0} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052cc",color:"#fff",fontWeight:500,cursor:"pointer",opacity:(running||chosen.length===0)?0.6:1}}>{running?"Distributing\u2026":`Distribute to ${chosen.length}`}</button>
          </div>
        </>) : (<>
          <div style={{fontSize:13,color:"#2C2C2A",marginBottom:12}}>Distributed <b>{result.distributed}</b> invoices.</div>
          <div style={{fontSize:12,color:"#6B6A64",marginBottom:8}}>By bucket: 1-30: {result.buckets['1-30']} · 31-60: {result.buckets['31-60']} · 61-90: {result.buckets['61-90']} · 91-180: {result.buckets['91-180']} · 181+: {result.buckets['181+']}</div>
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
            <button onClick={()=>onDone(result)} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#0052cc",color:"#fff",fontWeight:500,cursor:"pointer"}}>Done</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

function StagesPage({officeFilter, showToast}: any) {
  const [data,setData]=useState<any>(null);
  const [loadingS,setLoadingS]=useState(true);
  const [filter,setFilter]=useState<"all"|"COLLECTIONS"|"SCC"|"BAD_DEBT">("all");

  const load=useCallback(()=>{
    setLoadingS(true);
    fetch(`/api/ar/stages?office=${officeFilter||'All'}`).then(r=>r.json()).then(d=>{setData(d);setLoadingS(false);}).catch(()=>setLoadingS(false));
  },[officeFilter]);
  useEffect(()=>{load();},[load]);

  const money=(n:number)=>'$'+Math.round(n).toLocaleString();
  const LABEL:any={COLLECTIONS:"Collections",SCC:"SCC",BAD_DEBT:"Bad Debt"};
  const COLOR:any={COLLECTIONS:{bg:"#EAEEF6",fg:"#2E4A79"},SCC:{bg:"#FBF0E4",fg:"#8A5A1E"},BAD_DEBT:{bg:"#F6EAEA",fg:"#791F1F"}};

  const moveBack=async(invoiceId:string)=>{
    await fetch('/api/ar/call-sheet',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceId,arStage:null})});
    load(); showToast&&showToast("Moved back to call sheet");
  };

  if(loadingS) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"#888780"}}>Loading…</div>;
  const all=data?.items||[];
  const items=all.filter((it:any)=>filter==="all"||it.status===filter);

  return (
    <div>
      <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:600,color:"#2C2C2A"}}>Collections / SCC / Bad Debt</div>
        <div style={{fontSize:13,color:"#888780"}}>{items.length} account{items.length!==1?"s":""}</div>
      </div>

      <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#F1EFE8",border:"0.5px solid #E8E7E3",marginBottom:14}}>
        {(["all","COLLECTIONS","SCC","BAD_DEBT"] as const).map(s=>(
          <button key={s} onClick={()=>setFilter(s)} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:filter===s?"0.5px solid #D3D1C7":"0.5px solid transparent",background:filter===s?"#fff":"transparent",color:filter===s?"#2C2C2A":"#888780"}}>
            {s==="all"?"All":LABEL[s]}
          </button>
        ))}
      </div>

      {items.length>0 ? (
        <div style={{background:"#fff",borderRadius:12,border:"0.5px solid #E8E7E3",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{color:"#888780",textAlign:"left"}}>
                <th style={{padding:"10px 14px",fontWeight:500}}>Customer</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Service</th>
                <th style={{padding:"10px 14px",fontWeight:500,textAlign:"right"}}>Outstanding</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Status</th>
                <th style={{padding:"10px 14px",fontWeight:500}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it:any)=>(
                <tr key={it.invoiceId} style={{borderTop:"0.5px solid #F1EFE8"}}>
                  <td style={{padding:"10px 14px",fontWeight:500,color:"#2C2C2A"}}>{it.customerName}<div style={{fontSize:11,color:"#B4B2A9"}}>{it.serviceAddr||""}</div></td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:11,padding:"2px 7px",borderRadius:6,background:it.serviceCategory==="Wildlife"?"#E9F1E5":"#EAEEF6",color:it.serviceCategory==="Wildlife"?"#3F6B2E":"#2E4A79"}}>{it.serviceCategory}</span></td>
                  <td style={{padding:"10px 14px",textAlign:"right",fontWeight:600,color:"#791F1F"}}>{money(it.outstanding)}</td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:11,padding:"3px 9px",borderRadius:6,fontWeight:500,background:COLOR[it.status]?.bg,color:COLOR[it.status]?.fg}}>{LABEL[it.status]}</span></td>
                  <td style={{padding:"10px 14px"}}><button onClick={()=>moveBack(it.invoiceId)} style={{background:"#fff",color:"#6B6A64",border:"0.5px solid #D3D1C7",padding:"5px 10px",borderRadius:7,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>Back to sheet</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{padding:40,textAlign:"center",fontSize:13,color:"#888780",background:"#fff",borderRadius:12,border:"0.5px solid #E8E7E3"}}>No accounts in this stage.</div>
      )}
    </div>
  );
}

function DashPage({open,totalAR,totalOverdue,collected,agingTotals,payments,prevMonthAR,collectedDays,setCollectedDays,customDateFrom,customDateTo,setCustomDateFrom,setCustomDateTo}: any) {
  const arVsBenchmark = prevMonthAR > 0 ? ((totalAR - prevMonthAR) / prevMonthAR) * 100 : 0;
  const openInvoices = open.length;

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:12}}>
        <MC label="Total AR" value={fmt(totalAR)} sub={openInvoices+" open invoices"} color={ACCENT}/>
        <MC label="Open AR" value={fmt(totalAR)} sub={openInvoices+" invoices"}/>
        <MC label="Total past due" value={fmt(totalOverdue)} color="#A32D2D"/>
        <MC label="Open invoices" value={openInvoices}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:12}}>
        <MC label="1–30 days AR" value={fmt(agingTotals["1-30"])} color="#1D9E75"/>
        <MC label="31–60 days AR" value={fmt(agingTotals["31-60"])} color="#BA7517"/>
        <MC label="61–90 days AR" value={fmt(agingTotals["61-90"])} color="#BA7517"/>
        <MC label="90+ days AR" value={fmt(agingTotals["90+"])} color="#A32D2D"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
        <MC label="AR benchmark" value={fmt(prevMonthAR)} sub="Previous month"/>
        <MC label="AR vs benchmark" value={(arVsBenchmark>=0?"+":"")+arVsBenchmark.toFixed(1)+"%"} color={arVsBenchmark>0?"#A32D2D":"#1D9E75"} sub={arVsBenchmark>0?"Above last month":"Below last month"}/>
        <div style={{background:"#F1EFE8",borderRadius:8,padding:"14px 16px",border:"0.5px solid #E8E7E3"}}>
          <div style={{fontSize:12,color:"#888780",marginBottom:4,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span>Payments collected</span>
            <select value={collectedDays} onChange={e=>setCollectedDays(Number(e.target.value))} style={{fontSize:11,padding:"1px 4px",borderRadius:4,border:"0.5px solid #ccc",background:"#fff"}}>
              <option value={7}>7d</option><option value={30}>30d</option><option value={60}>60d</option><option value={90}>90d</option><option value={365}>YTD</option><option value={0}>Custom</option>
            </select>
            {collectedDays===0 && (
              <div style={{display:"flex",alignItems:"center",gap:4,marginTop:4,width:"100%"}}>
                <input type="date" value={customDateFrom} onChange={e=>setCustomDateFrom(e.target.value)} style={{fontSize:10,padding:"2px 4px",borderRadius:4,border:"0.5px solid #ccc",width:"100px"}}/>
                <span style={{fontSize:10,color:"#888780"}}>to</span>
                <input type="date" value={customDateTo} onChange={e=>setCustomDateTo(e.target.value)} style={{fontSize:10,padding:"2px 4px",borderRadius:4,border:"0.5px solid #ccc",width:"100px"}}/>
              </div>
            )}
          </div>
          <div style={{fontSize:20,fontWeight:500,color:"#1D9E75"}}>{fmt(collected)}</div>
        </div>
      </div>
    </div>
  );
}

function CustPage({customers,enriched,setModal,showToast,loadAll}: any) {
  const [search,setSearch]=useState("");
  const [pageSize,setPageSize]=useState(100);
  const [currentPage,setCurrentPage]=useState(1);

  const balBC=useMemo(()=>{const m:any={};enriched.forEach((i:any)=>{if(i.status!=="PAID")m[i.customerId]=(m[i.customerId]||0)+i.balance});return m},[enriched]);

  const filtered=customers.filter((c:any)=>{
    if(!search) return true;
    const s=search.toLowerCase();
    return c.name?.toLowerCase().includes(s) ||
           c.phone?.includes(search) ||
           c.externalId?.includes(search);
  });

  const totalPages=Math.ceil(filtered.length/pageSize);
  const displayed=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center"}}>
        <input
          placeholder="Search by name, phone or FR ID..."
          value={search}
          onChange={e=>{setSearch(e.target.value);setCurrentPage(1);}}
          style={{flex:1,maxWidth:360,fontSize:13,padding:"7px 10px",border:"0.5px solid #B4B2A9",borderRadius:8,background:"#fff"}}
        />
        <span style={{fontSize:12,color:"#888780",marginLeft:"auto"}}>{filtered.length} customers</span>
      </div>
      <Card noPad>
        <div style={{overflowX:"auto",maxHeight:"calc(100vh - 260px)",overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,zIndex:5}}>
              <tr><Th>Customer</Th><Th>Phone</Th><Th>FR ID</Th><Th>Address</Th><Th right>Open AR</Th><Th>Invoices</Th></tr>
            </thead>
            <tbody>
              {displayed.map((c:any)=>(
                <tr key={c.id} style={{cursor:"pointer"}} onClick={()=>setModal({type:"customerDetail",customer:c})}>
                  <Td bold><div>{c.name}</div><div style={{fontSize:11,color:"#888780"}}>{c.email}</div></Td>
                  <Td>{c.phone||"—"}</Td>
                  <Td style={{fontSize:12,color:"#888780"}}>{c.externalId||"—"}</Td>
                  <Td style={{fontSize:12,color:"#888780",maxWidth:200}}>{c.serviceAddr||"—"}</Td>
                  <Td right bold color={balBC[c.id]>0?"#2C2C2A":"#B4B2A9"}>{balBC[c.id]?fmt(balBC[c.id]):"—"}</Td>
                  <Td>{enriched.filter((i:any)=>i.customerId===c.id).length}</Td>
                </tr>
              ))}
              {displayed.length===0&&<ER cols={6} msg="No customers found"/>}
            </tbody>
          </table>
        </div>
        <Pagination current={currentPage} total={filtered.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
      </Card>
    </div>
  );
}

function InvPage({enriched,setModal,showToast,loadAll}: any) {
  const [search,setSearch]=useState("");
  const [statusF,setStatusF]=useState("");
  const [pageSize,setPageSize]=useState(100);
  const [currentPage,setCurrentPage]=useState(1);

  const sorted = useMemo(()=>[...enriched].sort((a:any,b:any)=>new Date(b.date).getTime()-new Date(a.date).getTime()),[enriched]);

  const filtered=sorted.filter((i:any)=>{
    if(statusF&&i.status!==statusF)return false;
    if(search){const s=search.toLowerCase();if(!i.id?.toLowerCase().includes(s)&&!i.customer?.name?.toLowerCase().includes(s))return false;}
    return true;
  });

  const displayed=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);

  const del=async(id:string)=>{if(!confirm("Delete invoice "+id+"?"))return;await fetch(`/api/invoices/${id}`,{method:"DELETE"});showToast("Invoice deleted");loadAll();};

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        <input placeholder="Search invoice # or customer..." value={search} onChange={e=>{setSearch(e.target.value);setCurrentPage(1);}} style={{flex:1,minWidth:200,fontSize:13,padding:"7px 10px",border:"0.5px solid #B4B2A9",borderRadius:8,background:"#fff"}}/>
        <select value={statusF} onChange={e=>{setStatusF(e.target.value);setCurrentPage(1);}} style={{fontSize:13,padding:"7px 10px",border:"0.5px solid #B4B2A9",borderRadius:8,background:"#fff"}}>
          <option value="">All statuses</option>
          {["CURRENT","OVERDUE","COLLECTIONS","PAYMENT_PLAN","PAID","DISPUTED"].map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}
        </select>
        <span style={{fontSize:12,color:"#888780",marginLeft:"auto"}}>{filtered.length} invoices</span>
      </div>
      <Card noPad>
        <div style={{overflowY:"auto",maxHeight:"calc(100vh - 260px)"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,zIndex:5}}>
              <tr><Th>Invoice #</Th><Th>Customer</Th><Th>Date</Th><Th>Due date</Th><Th right>Amount</Th><Th right>Balance</Th><Th>Status</Th><Th>&nbsp;</Th></tr>
            </thead>
            <tbody>
              {displayed.map((inv:any)=>(
                <tr key={inv.id}>
                  <Td bold>{inv.id}</Td>
                  <Td>{inv.customer?.name||"—"}</Td>
                  <Td>{inv.date?.split("T")[0]}</Td>
                  <Td color={inv.daysOverdue>0?"#A32D2D":"inherit"}>{inv.due?.split("T")[0]||"—"}</Td>
                  <Td right>{fmt(Number(inv.amount))}</Td>
                  <Td right bold>{fmt(inv.balance)}</Td>
                  <Td><Badge status={inv.status} small/></Td>
                  <Td>
                    {inv.balance>0&&<Btn small onClick={()=>setModal({type:"closeOut",invoice:inv})}>Close out</Btn>}
                  </Td>
                </tr>
              ))}
              {displayed.length===0&&<ER cols={8} msg="No invoices match"/>}
            </tbody>
          </table>
        </div>
        <Pagination current={currentPage} total={filtered.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
      </Card>
    </div>
  );
}

function PayPage({payments,invoices,custMap,showToast,loadAll,setModal}: any) {
  const [pageSize,setPageSize]=useState(100);
  const [currentPage,setCurrentPage]=useState(1);
  const ep=payments.map((p:any)=>{const inv=invoices.find((i:any)=>i.id===p.invoiceId);return{...p,customer:inv?custMap[inv.customerId]:null}}).sort((a:any,b:any)=>a.date>b.date?-1:1);
  const del=async(id:string)=>{if(!confirm("Delete this payment?"))return;await fetch(`/api/payments/${id}`,{method:"DELETE"});showToast("Payment deleted");loadAll();};
  const displayed=ep.slice((currentPage-1)*pageSize,currentPage*pageSize);

  return (
    <div>
      <div style={{marginBottom:"1rem",fontSize:13,color:"#888780"}}>
        {payments.length} payments
      </div>
      <Card noPad>
        <div style={{overflowX:"auto",maxHeight:"calc(100vh - 320px)",overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,zIndex:5}}>
              <tr><Th>Customer</Th><Th>Invoice</Th><Th>Date</Th><Th>Method</Th><Th right>Amount</Th><Th>Reference</Th><Th>&nbsp;</Th></tr>
            </thead>
            <tbody>
              {displayed.map((p:any)=>(
                <tr key={p.id}>
                  <Td bold>{p.customer?.name||"—"}</Td>
                  <Td>{p.invoiceId}</Td>
                  <Td>{p.date?.split("T")[0]}</Td>
                  <Td><span style={{fontSize:12,fontWeight:500,color:"#185FA5"}}>{p.method}</span></Td>
                  <Td right bold color="#1D9E75">{fmt(Number(p.amount))}</Td>
                  <Td style={{fontSize:12,color:"#888780"}}>{p.reference||"—"}</Td>
                  <Td><Btn small danger onClick={()=>del(p.id)}>✕</Btn></Td>
                </tr>
              ))}
              {displayed.length===0&&<ER cols={7} msg="No payments yet"/>}
            </tbody>
          </table>
        </div>
        <Pagination current={currentPage} total={ep.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
      </Card>
    </div>
  );
}

function AgePage({open,agingTotals,custMap}: any) {
  const [pageSize,setPageSize]=useState(100);
  const [currentPage,setCurrentPage]=useState(1);
  const [selectedBucket,setSelectedBucket]=useState<string|null>(null);

  const buckets=["current","1-30","31-60","61-90","90+"];
  const bC:any={current:"#1D9E75","1-30":"#1D9E75","31-60":"#BA7517","61-90":"#BA7517","90+":"#A32D2D"};
  const total=Object.values(agingTotals).reduce((a:any,b:any)=>a+b,0)||1;

  const byCust=useMemo(()=>{
    const m:any={};
    open.forEach((inv:any)=>{
      if(!m[inv.customerId])m[inv.customerId]={...Object.fromEntries(buckets.map(b=>[b,0]))};
      const d=inv.daysOverdue;
      const b=d<=0?"current":d<=30?"1-30":d<=60?"31-60":d<=90?"61-90":"90+";
      m[inv.customerId][b]+=inv.balance;
    });
    return Object.entries(m).map(([id,bkts]:any)=>({...bkts,customer:custMap[id],total:Object.values(bkts).reduce((a:any,b:any)=>a+b,0)})).sort((a:any,b:any)=>b.total-a.total);
  },[open,custMap]);

  const filtered = selectedBucket
    ? byCust.filter((r:any) => r[selectedBucket] > 0)
    : byCust;

  const displayed=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);

  const tileLabel = (b:string) => b==="current"?"Current":b+" days";

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10,marginBottom:"1.5rem"}}>
        {buckets.map(b=>(
          <MC
            key={b}
            label={tileLabel(b)}
            value={fmt((agingTotals as any)[b])}
            sub={open.filter((i:any)=>{const d=i.daysOverdue;const bk=d<=0?"current":d<=30?"1-30":d<=60?"31-60":d<=90?"61-90":"90+";return bk===b;}).length+" invoices"}
            color={bC[b]}
            clickable
            selected={selectedBucket===b}
            onClick={()=>{setSelectedBucket(selectedBucket===b?null:b);setCurrentPage(1);}}
          />
        ))}
        <MC
          label="Total AR"
          value={fmt(Number(total))}
          sub={open.length+" invoices"}
          clickable
          selected={selectedBucket===null}
          onClick={()=>{setSelectedBucket(null);setCurrentPage(1);}}
        />
      </div>
      <div style={{fontSize:14,fontWeight:500,marginBottom:12,color:"#2C2C2A"}}>
        {selectedBucket ? `${tileLabel(selectedBucket)} customers` : "All customers"} — {filtered.length} results
      </div>
      <Card noPad>
        <div style={{overflowX:"auto",maxHeight:"calc(100vh - 360px)",overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,zIndex:5}}>
              <tr><Th>Customer</Th>{buckets.map(b=><Th key={b} right>{tileLabel(b)}</Th>)}<Th right>Total</Th></tr>
            </thead>
            <tbody>
              {displayed.map((r:any,idx:number)=>(
                <tr key={idx}>
                  <Td bold>{r.customer?.name||"—"}</Td>
                  {buckets.map(b=><Td key={b} right color={r[b]>0?bC[b]:"#B4B2A9"} style={{fontWeight:r[b]>0?500:400}}>{r[b]>0?fmt(r[b]):"—"}</Td>)}
                  <Td right bold>{fmt(r.total)}</Td>
                </tr>
              ))}
              {displayed.length===0&&<ER cols={7} msg="No customers in this bucket"/>}
            </tbody>
            <tfoot>
              <tr style={{background:"#F8F7F4"}}>
                <td style={{padding:"9px 12px",fontWeight:500,fontSize:13}}>Total</td>
                {buckets.map(b=><td key={b} style={{padding:"9px 12px",textAlign:"right",fontWeight:500,fontSize:13,color:bC[b]}}>{fmt((agingTotals as any)[b])}</td>)}
                <td style={{padding:"9px 12px",textAlign:"right",fontWeight:500,fontSize:13}}>{fmt(Number(total))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <Pagination current={currentPage} total={filtered.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
      </Card>
    </div>
  );
}

function InvModal({customers,invoice,onClose,showToast,loadAll,officeFilter}: any) {
  const isEdit=!!invoice;
  const ts=new Date().toISOString().split("T")[0];
  const [f,setF]=useState({customerId:invoice?.customerId||"",id:invoice?.id||"INV-"+Math.floor(1000+Math.random()*8000),date:invoice?.date?.split("T")[0]||ts,due:invoice?.due?.split("T")[0]||"",amount:String(invoice?.amount||""),description:invoice?.description||"",serviceType:invoice?.serviceType||"Wildlife",status:invoice?.status||"CURRENT"});
  const set=(k:string,v:string)=>setF(p=>({...p,[k]:v}));
  const submit=async()=>{
    if(!f.customerId||!f.amount)return showToast("Fill required fields","error");
    const method=isEdit?"PUT":"POST";
    const url=isEdit?`/api/invoices/${invoice.id}`:"/api/invoices";
    await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({...f,amount:parseFloat(f.amount),paid:invoice?.paid||0,office:officeFilter!=="ALL"?officeFilter:"DFW"})});
    showToast(isEdit?"Invoice updated":"Invoice created");loadAll();onClose();
  };
  return (
    <Modal title={isEdit?"Edit invoice":"Create invoice"} onClose={onClose}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Inp label="Customer *" value={f.customerId} onChange={v=>set("customerId",v)} options={[{value:"",label:"Select customer…"},...customers.map((c:any)=>({value:c.id,label:c.name}))]}/>
        <Inp label="Invoice # *" value={f.id} onChange={v=>set("id",v)} disabled={isEdit}/>
        <Inp label="Issue date" value={f.date} onChange={v=>set("date",v)} type="date"/>
        <Inp label="Amount ($) *" value={f.amount} onChange={v=>set("amount",v)} type="number"/>
        <Inp label="Status" value={f.status} onChange={v=>set("status",v)} options={["CURRENT","OVERDUE","COLLECTIONS","PAYMENT_PLAN","DISPUTED","PAID"].map(s=>({value:s,label:statusLabels[s]}))}/>
        <Inp label="Service type" value={f.serviceType} onChange={v=>set("serviceType",v)} options={[{value:"Wildlife",label:"Wildlife"},{value:"Pest Control",label:"Pest Control"}]}/>
        <Inp label="Description" value={f.description} onChange={v=>set("description",v)} placeholder="Services…" style={{gridColumn:"span 2"}}/>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={submit}>{isEdit?"Save changes":"Create invoice"}</Btn>
      </div>
    </Modal>
  );
}

function PayModal({invoice,invoices,enriched,custMap,onClose,showToast,loadAll}: any) {
  const ts=new Date().toISOString().split("T")[0];
  const openInvs=(enriched||[]).filter((i:any)=>i.balance>0);
  const [selId,setSelId]=useState(invoice?.id||"");
  const [f,setF]=useState({amount:invoice?String(Math.round(invoice.balance)):"",date:ts,method:"ACH",reference:"",note:""});
  const set=(k:string,v:string)=>setF(p=>({...p,[k]:v}));
  const submit=async()=>{
    const amt=parseFloat(f.amount);
    if(!selId||isNaN(amt)||amt<=0)return showToast("Fill required fields","error");
    await fetch("/api/payments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({invoiceId:selId,amount:amt,date:f.date,method:f.method,reference:f.reference,note:f.note})});
    showToast("Payment of "+fmt(amt)+" recorded");loadAll();onClose();
  };
  return (
    <Modal title={invoice?"Record payment — "+invoice.id:"Record payment"} onClose={onClose}>
      {invoice&&<div style={{background:"#F7F6F2",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:13}}>
        <div style={{fontWeight:500}}>{custMap[invoice.customerId]?.name} · {invoice.id}</div>
        <div style={{color:"#888780",marginTop:2}}>Balance: <strong>{fmt(invoice.balance)}</strong></div>
      </div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {!invoice&&<Inp label="Invoice *" value={selId} onChange={v=>{setSelId(v);const i=openInvs.find((x:any)=>x.id===v);if(i)set("amount",String(Math.round(i.balance)));}} options={[{value:"",label:"Select invoice…"},...openInvs.map((i:any)=>({value:i.id,label:`${i.id} — ${i.customer?.name} (${fmt(i.balance)})`}))]} style={{gridColumn:"span 2"}}/>}
        <Inp label="Amount ($)" value={f.amount} onChange={v=>set("amount",v)} type="number"/>
        <Inp label="Date" value={f.date} onChange={v=>set("date",v)} type="date"/>
        <Inp label="Method" value={f.method} onChange={v=>set("method",v)} options={["ACH","Check","Wire","Credit Card","Cash","Other"].map(s=>({value:s,label:s}))}/>
        <Inp label="Reference #" value={f.reference} onChange={v=>set("reference",v)} placeholder="Optional"/>
        <Inp label="Note" value={f.note} onChange={v=>set("note",v)} style={{gridColumn:"span 2"}}/>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={submit}>Record payment</Btn>
      </div>
    </Modal>
  );
}

function CustDetail({customer:c,enriched,custMap,setModal,onClose}: any) {
  const [allInvs, setAllInvs] = useState<any[]>([]);
  const [loadingInvs, setLoadingInvs] = useState(true);

  useEffect(() => {
    fetch(`/api/invoices?office=${c.office}&showPaid=true`)
      .then(r => r.json())
      .then(data => {
        const arr = Array.isArray(data) ? data : [];
        setAllInvs(arr.filter((i:any) => i.customerId === c.id)
          .map((i:any) => ({...i, balance: Number(i.amount) - Number(i.paid)})));
        setLoadingInvs(false);
      });
  }, [c.id]);

  const invs = allInvs;
  const bal=invs.filter((i:any)=>i.status!=="PAID").reduce((s:number,i:any)=>s+i.balance,0);
  return (
    <Modal title={c.name} onClose={onClose} wide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16,background:"#F7F6F2",borderRadius:8,padding:"12px 14px"}}>
        <div><div style={{fontSize:11,color:"#888780"}}>Phone</div><div style={{fontSize:13}}>{c.phone||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>FR ID</div><div style={{fontSize:13}}>{c.externalId||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Email</div><div style={{fontSize:13}}>{c.email||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Address</div><div style={{fontSize:13}}>{c.serviceAddr||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Office</div><div style={{fontSize:13}}>{c.office||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Open AR</div><div style={{fontSize:16,fontWeight:500,color:bal>0?"#A32D2D":"inherit"}}>{fmt(bal)}</div></div>
      </div>
      <div style={{fontWeight:500,fontSize:13,marginBottom:8}}>Invoices ({invs.length})</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,marginBottom:16}}>
        <thead><tr><Th>Invoice</Th><Th>Date</Th><Th>Due</Th><Th right>Amount</Th><Th right>Balance</Th><Th>Status</Th></tr></thead>
        <tbody>{invs.sort((a:any,b:any)=>new Date(b.date).getTime()-new Date(a.date).getTime()).map((i:any)=><tr key={i.id}><Td bold>{i.id}</Td><Td>{i.date?.split("T")[0]}</Td><Td>{i.due?.split("T")[0]||"—"}</Td><Td right>{fmt(Number(i.amount))}</Td><Td right bold>{fmt(i.balance)}</Td><Td><Badge status={i.status} small/></Td></tr>)}</tbody>
      </table>
    </Modal>
  );
}

function CloseOutModal({invoice,custMap,onClose,showToast,loadAll}: any) {
  const today=new Date().toISOString().split("T")[0];
  const [closeOutDate,setCloseOutDate]=useState(today);
  async function submit() {
    if(!closeOutDate)return showToast("Select a closeout date","error");
    await fetch(`/api/invoices/${invoice.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({due:closeOutDate,status:new Date(closeOutDate)<new Date()?"OVERDUE":"CURRENT"})});
    showToast("Invoice closed out — due date set to "+closeOutDate);loadAll();onClose();
  }
  const cust=custMap[invoice.customerId];
  return (
    <Modal title={"Close out — "+invoice.id} onClose={onClose}>
      <div style={{background:"#F7F6F2",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>
        <div style={{fontWeight:500}}>{cust?.name} · {invoice.id}</div>
        <div style={{color:"#888780",marginTop:2}}>Amount: <strong>{fmt(Number(invoice.amount))}</strong></div>
      </div>
      <div style={{fontSize:13,color:"#2C2C2A",marginBottom:12}}>Select the close-out date. Aging starts from this date.</div>
      <Inp label="Close-out date" value={closeOutDate} onChange={setCloseOutDate} type="date"/>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={submit}>Close out invoice</Btn>
      </div>
    </Modal>
  );
}
