// v2
"use client";
import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import CollectionsTracker from "@/components/CollectionsTracker";
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, DataTable as CCDataTable, Toolbar as CCToolbar, SearchBox as CCSearchBox, CustomerCell as CCCustomerCell, FilterChips as CCFilterChips } from "@/components/cc/Layout";
import { SectionHeader as CCSectionHeader, Card as CCCard, StatusPill as CCStatusPill, Btn as CCBtn } from "@/components/cc/Primitives";
import { LastSynced } from "@/components/LastSynced";

const ACCENT = '#5B9BE0';
const TODAY = new Date();

const fmt = (n: number) => "$" + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number) => Math.round(n * 100) + "%";
const daysDiff = (ds: string) => Math.round((TODAY.getTime() - new Date(ds).getTime()) / 86400000);

const statusLabels: Record<string, string> = {
  CURRENT:"Current", OVERDUE:"Overdue", COLLECTIONS:"Collections", PAID:"Paid",
  PAYMENT_PLAN:"Payment Plan", DISPUTED:"Disputed", SUSPENDED:"Suspended", ACTIVE:"Active"
};

const BB: Record<string, {bg:string,c:string}> = {
  CURRENT:{bg:"#143229",c:"#085041"}, OVERDUE:{bg:"#FAEEDA",c:"#633806"},
  COLLECTIONS:{bg:"#361e1e",c:"#E57C7C"}, PAID:{bg:"#232329",c:"#444441"},
  PAYMENT_PLAN:{bg:"#E6F1FB",c:"#0C447C"}, DISPUTED:{bg:"#FBEAF0",c:"#72243E"},
  SUSPENDED:{bg:"#232329",c:"#444441"}, ACTIVE:{bg:"#143229",c:"#085041"},
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
      background: "#1C1C21",
      borderRadius:12, padding:"14px 18px",
      border: selected ? `1.5px solid ${ACCENT}` : "0.5px solid #2A2A30",
      borderLeft: `3px solid ${color || ACCENT}`,
      cursor: clickable ? "pointer" : "default",
      transition: "box-shadow 0.15s",
    }}
  >
    <div style={{fontSize:11,color:"#908E85",fontWeight:500,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{label}</div>
    <div style={{fontSize:24,fontWeight:500,color:color||"#F0EEE8"}}>{value}</div>
    {sub && <div style={{fontSize:11,color:"#63615A",marginTop:2}}>{sub}</div>}
  </div>
);

const Card = ({title,action,children,noPad}: {title?:string,action?:React.ReactNode,children:React.ReactNode,noPad?:boolean}) => (
  <div style={{background:"#1C1C21",border:"0.5px solid #2A2A30",borderRadius:12,padding:noPad?0:"1rem 1.25rem",marginBottom:"1rem",overflow:"hidden"}}>
    {title && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:noPad?0:"1rem",padding:noPad?"1rem 1.25rem 0.75rem":0,borderBottom:noPad?"0.5px solid #2A2A30":"none"}}>
      <span style={{fontSize:14,fontWeight:500}}>{title}</span>{action}
    </div>}
    {children}
  </div>
);

const Th = ({children,right}: {children:React.ReactNode,right?:boolean}) => (
  <th style={{textAlign:right?"right":"left",fontSize:11,fontWeight:500,color:"#908E85",padding:"8px 12px",borderBottom:"0.5px solid #2A2A30",whiteSpace:"nowrap",background:"#232329"}}>{children}</th>
);
const Td = ({children,right,bold,color,style:s}: {children?:React.ReactNode,right?:boolean,bold?:boolean,color?:string,style?:React.CSSProperties}) => (
  <td style={{padding:"10px 12px",borderBottom:"0.5px solid #232329",textAlign:right?"right":"left",fontWeight:bold?500:400,fontSize:13,verticalAlign:"middle",color:color||"inherit",...s}}>{children}</td>
);
const Btn = ({children,onClick,primary,small,danger,disabled}: {children:React.ReactNode,onClick?:()=>void,primary?:boolean,small?:boolean,danger?:boolean,disabled?:boolean}) => (
  <button onClick={onClick} disabled={disabled} style={{background:primary?ACCENT:danger?"#361e1e":"#1C1C21",color:primary?"#1C1C21":danger?"#E57C7C":"#F0EEE8",border:primary?"none":danger?"0.5px solid #4a2626":"0.5px solid #2A2A30",padding:small?"4px 10px":"7px 14px",borderRadius:8,cursor:disabled?"not-allowed":"pointer",fontSize:small?12:13,opacity:disabled?0.5:1,fontWeight:500,display:"inline-flex",alignItems:"center",gap:5}}>{children}</button>
);
const ER = ({cols,msg}: {cols:number,msg:string}) => (
  <tr><td colSpan={cols} style={{textAlign:"center",padding:"2rem",fontSize:13,color:"#908E85"}}>{msg}</td></tr>
);
const Modal = ({title,onClose,children,wide}: {title:string,onClose:()=>void,children:React.ReactNode,wide?:boolean}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(2px)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 16px",overflowY:"auto"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#1C1C21",borderRadius:14,border:"1px solid #35353C",width:"100%",maxWidth:wide?700:520,maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.5)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"16px 20px",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,background:"#1C1C21",zIndex:1}}>
        <span style={{fontSize:16,fontWeight:600,color:"#F0EEE8"}}>{title}</span>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:"#908E85",lineHeight:1}}>×</button>
      </div>
      <div style={{padding:"20px"}}>{children}</div>
    </div>
  </div>
);
const Inp = ({label,value,onChange,type,placeholder,options,style:s,disabled}: {label?:string,value:string,onChange:(v:string)=>void,type?:string,placeholder?:string,options?:{value:string,label:string}[],style?:React.CSSProperties,disabled?:boolean}) => (
  <div style={{display:"flex",flexDirection:"column",gap:5,...s}}>
    {label && <label style={{fontSize:12,color:"#908E85",fontWeight:600}}>{label}</label>}
    {options
      ? <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{fontSize:14,padding:"10px 12px",border:"1px solid #35353C",borderRadius:8,background:"#26262C",color:"#F0EEE8"}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
      : <input type={type||"text"} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} style={{fontSize:14,padding:"10px 12px",border:"1px solid #35353C",borderRadius:8,background:"#26262C",color:"#F0EEE8"}} />
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
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderTop:"0.5px solid #2A2A30",background:"#232329",flexWrap:"wrap",gap:8}}>
      <div style={{fontSize:12,color:"#908E85"}}>
        Showing {total===0?0:(current-1)*pageSize+1}–{Math.min(current*pageSize,total)} of {total} &nbsp;
        <select value={pageSize} onChange={e=>{onSize(Number(e.target.value));}} style={{fontSize:12,padding:"2px 6px",border:"0.5px solid #63615A",borderRadius:4}}>
          <option value={100}>100</option><option value={500}>500</option><option value={1000}>1000</option>
        </select> per page
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <button onClick={()=>onPage(Math.max(1,current-1))} disabled={current===1} style={{padding:"3px 10px",fontSize:12,border:"0.5px solid #2A2A30",borderRadius:4,background:current===1?"#232329":"#1C1C21",cursor:current===1?"not-allowed":"pointer"}}>Previous</button>
        {pageNums().map((p,i)=>p===-1
          ?<span key={i} style={{padding:"3px 6px",fontSize:12}}>…</span>
          :<button key={p} onClick={()=>onPage(p)} style={{padding:"3px 10px",fontSize:12,border:"0.5px solid #2A2A30",borderRadius:4,background:current===p?ACCENT:"#1C1C21",color:current===p?"#1C1C21":"#F0EEE8",cursor:"pointer"}}>{p}</button>
        )}
        <button onClick={()=>onPage(Math.min(totalPages,current+1))} disabled={current===totalPages} style={{padding:"3px 10px",fontSize:12,border:"0.5px solid #2A2A30",borderRadius:4,background:current===totalPages?"#232329":"#1C1C21",cursor:current===totalPages?"not-allowed":"pointer"}}>Next</button>
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

  async function loadAll(office?: string, _retry = 0) {
    setLoading(true);
    const o = office || officeFilter;
    const oq = o !== "ALL" ? `?office=${o}` : "";
    try {
      const [c,i,p] = await Promise.all([
        fetch(`/api/customers${oq}`).then(r=>{ if(!r.ok) throw new Error(`customers ${r.status}`); return r.json(); }),
        fetch(`/api/invoices${oq}`).then(r=>{ if(!r.ok) throw new Error(`invoices ${r.status}`); return r.json(); }),
        fetch(`/api/payments?days=365${o !== "ALL" ? `&office=${o}` : ""}`).then(r=>{ if(!r.ok) throw new Error(`payments ${r.status}`); return r.json(); }),
      ]);
      // If any core response isn't an array, it's an error/not-ready response — don't store it as empty
      // (that's what showed $0). Retry once after a short delay (covers cold DB/session on first load).
      if (!Array.isArray(c) || !Array.isArray(i)) {
        if (_retry < 2) { await new Promise(r=>setTimeout(r, 600)); return loadAll(office, _retry+1); }
        throw new Error("Data not ready");
      }
      setCustomersState(c);
      setInvoicesState(i);
      setPaymentsState(Array.isArray(p)?p:[]);
    } catch(e:any) {
      if (_retry < 2) { await new Promise(r=>setTimeout(r, 600)); return loadAll(office, _retry+1); }
      showToast(`Failed to load data: ${e?.message||'unknown'} — please refresh`,"error");
      console.error("AR loadAll failed:", e);
    }
    setLoading(false);
  }



  useEffect(()=>{ loadAll(); },[]);

  // One-time admin check (Tracking tab is admin-only). Reuses the blitz endpoint's isAdmin flag.
  const [isAdmin,setIsAdmin]=useState(false);
  useEffect(()=>{ fetch('/api/ar/blitz?office=All').then(r=>r.json()).then(d=>setIsAdmin(!!d?.isAdmin)).catch(()=>{}); },[]);

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
    {id:"customers",label:"Customers"},
    {id:"invoices",label:"Invoices"},
    {id:"payments",label:"Payments"},
    {id:"aging",label:"Aging"},
    {id:"callsheet",label:"Call Sheet"},
    {id:"stages",label:"Collections / SCC / Bad Debt"},
  ];

  if(loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,fontSize:13,color:"#908E85"}}>Loading AR data…</div>;

  const shared = {customers,invoices,payments,custMap,enriched,open,setModal,showToast,loadAll,officeFilter,isAdmin};

  return (
    <div style={{padding:"30px 34px 70px",maxWidth:1280,margin:"0 auto"}}>
      {toast && <div style={{position:"fixed",top:16,right:16,zIndex:2000,background:toast.type==="error"?"#361e1e":"#143229",color:toast.type==="error"?"#E57C7C":"#43B892",border:`1px solid ${toast.type==="error"?"#4a2626":"#2e5a4c"}`,borderRadius:8,padding:"10px 16px",fontSize:13,fontWeight:500}}>{toast.msg}</div>}

      <CCPageHeader icon="💰" title="Accounts Receivable" subtitle="Collections, call sheet, aging, and payment tracking across every office" />

      {/* Sub-nav + office selector */}
      <div style={{display:"flex",gap:10,marginBottom:22,alignItems:"center",justifyContent:"space-between",flexWrap:"wrap"}}>
        <div style={{display:"inline-flex",gap:7,flexWrap:"wrap"}}>
          {PAGES.map(p=>{
            const on = page===p.id;
            const base:React.CSSProperties={padding:"7px 14px",borderRadius:9,fontSize:12.5,fontWeight:on?600:500,cursor:"pointer",whiteSpace:"nowrap",textDecoration:"none",border:`1px solid ${on?"#5B9BE0":"#2A2A30"}`,background:on?"#15263a":"#1C1C21",color:on?"#5B9BE0":"#908E85"};
            return (p as any).href
              ? <a key={p.id} href={(p as any).href} style={{...base,border:"1px solid #2A2A30",background:"#1C1C21",color:"#908E85"}}>{p.label}</a>
              : <button key={p.id} onClick={()=>setPage(p.id)} style={base}>{p.label}</button>;
          })}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{display:"inline-flex",gap:5}}>
            {["ALL","DFW","ATX","OKC","CStat"].map(o=>{
              const on=officeFilter===o;
              return <button key={o} onClick={()=>{setOfficeFilter(o);loadAll(o);}} style={{padding:"7px 13px",borderRadius:9,fontSize:12.5,fontWeight:on?600:500,cursor:"pointer",border:`1px solid ${on?"#5B9BE0":"#2A2A30"}`,background:on?"#15263a":"#1C1C21",color:on?"#5B9BE0":"#908E85"}}>{o==="ALL"?"All":o}</button>;
            })}
          </div>
          <LastSynced office={officeFilter} />
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {page==="dashboard" && (loading && !invoices.length
        ? <div style={{padding:60,textAlign:"center",fontSize:14,color:"#908E85"}}>Loading AR data…</div>
        : <DashPage {...shared} totalAR={totalAR} totalOverdue={totalOverdue} collected={collected} agingTotals={agingTotals} collectedDays={collectedDays} setCollectedDays={setCollectedDays} customDateFrom={customDateFrom} customDateTo={customDateTo} setCustomDateFrom={setCustomDateFrom} setCustomDateTo={setCustomDateTo} prevMonthAR={prevMonthAR} />)}
      {page==="callsheet" && <CallSheetPage officeFilter={officeFilter} showToast={showToast} />}
      {page==="blitz" && <BlitzPage officeFilter={officeFilter} showToast={showToast} />}
      {page==="tracking" && isAdmin && <TrackingPage />}
      {page==="stages" && <CollectionsTracker embedded />}
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
  const [sortBy, setSortBy] = useState<"overdue"|"outstanding"|"lastCall">("overdue");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [calledFilter, setCalledFilter] = useState<"all"|"notyet"|"called">("all");
  const [expanded, setExpanded] = useState<Record<string,boolean>>({});

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

  if(loadingCS) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"#908E85"}}>Loading call sheet…</div>;

  const allItems = data?.items||[];
  const items = allItems.filter((it:any)=>{
    const matchSearch = !search.trim() || (it.customerName||'').toLowerCase().includes(search.toLowerCase());
    const matchSvc = svcFilter==="all" || it.serviceCategory===svcFilter;
    const matchCalled = calledFilter==="all" || (calledFilter==="called" ? it.calledThisWindow : !it.calledThisWindow);
    return matchSearch && matchSvc && matchCalled;
  }).sort((a:any,b:any)=>{
    const dir = sortDir==="asc" ? 1 : -1;
    if(sortBy==="outstanding") return (a.outstanding - b.outstanding) * dir;
    if(sortBy==="lastCall") {
      // never-called sorts as "longest since call" (most urgent). Treat null as +Infinity days.
      const av = a.daysSinceCall==null ? Number.POSITIVE_INFINITY : a.daysSinceCall;
      const bv = b.daysSinceCall==null ? Number.POSITIVE_INFINITY : b.daysSinceCall;
      return (av - bv) * dir;
    }
    return (a.daysOverdue - b.daysOverdue) * dir;
  });

  const toggleSort=(col:"overdue"|"outstanding"|"lastCall")=>{
    if(sortBy===col){ setSortDir(d=>d==="asc"?"desc":"asc"); }
    else { setSortBy(col); setSortDir("desc"); }
  };
  const sortArrow=(col:string)=> sortBy===col ? (sortDir==="asc"?" ▲":" ▼") : "";
  const notYetCount = allItems.filter((it:any)=>!it.calledThisWindow).length;

  return (
    <div>
      <CCSectionHeader note={`${items.length} to call${allItems.length===0?" — all caught up 🎉":""}`}>Today&apos;s Call Sheet</CCSectionHeader>

      {/* Filters */}
      <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"inline-flex",gap:6}}>
          {(["all","Pest Control","Wildlife"] as const).map(s=>{const on=svcFilter===s;return(
            <button key={s} onClick={()=>setSvcFilter(s)} style={{padding:"7px 13px",borderRadius:9,fontSize:12.5,fontWeight:on?600:500,cursor:"pointer",border:`1px solid ${on?"#5B9BE0":"#2A2A30"}`,background:on?"#15263a":"#1C1C21",color:on?"#5B9BE0":"#908E85"}}>{s==="all"?"All Services":s}</button>
          );})}
        </div>
        <div style={{display:"inline-flex",gap:6}}>
          {([["all","All"],["notyet","Not called yet"],["called","Called"]] as const).map(([v,label])=>{const on=calledFilter===v;return(
            <button key={v} onClick={()=>setCalledFilter(v as any)} style={{padding:"7px 13px",borderRadius:9,fontSize:12.5,fontWeight:on?600:500,cursor:"pointer",border:`1px solid ${on?(v==="notyet"?"#E57C7C":"#5B9BE0"):"#2A2A30"}`,background:on?(v==="notyet"?"#361e1e":"#15263a"):"#1C1C21",color:on?(v==="notyet"?"#E57C7C":"#5B9BE0"):"#908E85"}}>{label}{v==="notyet"&&notYetCount>0?` (${notYetCount})`:""}</button>
          );})}
        </div>
        <div style={{marginLeft:"auto",minWidth:220}}><CCSearchBox value={search} onChange={setSearch} placeholder="Search customer…" /></div>
      </div>

      {items.length>0 ? (
        <div style={{background:"#1C1C21",borderRadius:14,border:"1px solid #2A2A30",overflow:"auto",maxHeight:"64vh"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{textAlign:"left"}}>
                <th style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,zIndex:2}}>Customer</th>
                <th style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,zIndex:2}}>Service</th>
                <th onClick={()=>toggleSort("outstanding")} style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",textAlign:"right",cursor:"pointer",userSelect:"none",color:sortBy==="outstanding"?"#5B9BE0":"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,zIndex:2}}>Outstanding{sortArrow("outstanding")}</th>
                <th onClick={()=>toggleSort("overdue")} style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",textAlign:"right",cursor:"pointer",userSelect:"none",color:sortBy==="overdue"?"#5B9BE0":"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,zIndex:2}}>Overdue{sortArrow("overdue")}</th>
                <th onClick={()=>toggleSort("lastCall")} style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",textAlign:"right",cursor:"pointer",userSelect:"none",color:sortBy==="lastCall"?"#5B9BE0":"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,zIndex:2}}>Last Call{sortArrow("lastCall")}</th>
                <th style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,zIndex:2}}>Phone</th>
                <th style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",minWidth:180,position:"sticky",top:0,zIndex:2}}>Note</th>
                <th style={{padding:"13px 16px",fontWeight:600,fontSize:11,letterSpacing:".05em",textTransform:"uppercase",color:"#908E85",background:"#232329",borderBottom:"1px solid #2A2A30",position:"sticky",top:0,zIndex:2}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it:any)=>{
                const noteVal = noteEdits[it.invoiceId]!==undefined ? noteEdits[it.invoiceId] : it.arNote;
                const dirty = noteEdits[it.invoiceId]!==undefined && noteEdits[it.invoiceId]!==it.arNote;
                return (
                <tr key={it.invoiceId} style={{borderTop:"1px solid #2A2A30"}}>
                  <td style={{padding:"12px 16px",fontWeight:600,color:"#F0EEE8"}}>
                    {it.customerName}
                    <div style={{fontSize:11,color:"#63615A"}}>{it.serviceAddr||""}</div>
                  </td>
                  <td style={{padding:"12px 16px"}}>
                    <span style={{fontSize:11.5,fontWeight:600,padding:"3px 10px",borderRadius:20,background:it.serviceCategory==="Wildlife"?"#143229":"#15263a",color:it.serviceCategory==="Wildlife"?"#43B892":"#5B9BE0"}}>{it.serviceCategory}</span>
                  </td>
                  <td style={{padding:"12px 16px",textAlign:"right",fontWeight:700,color:"#E57C7C",fontVariantNumeric:"tabular-nums"}}>{money(it.outstanding)}</td>
                  <td style={{padding:"12px 16px",textAlign:"right",color:"#C9C7BF",fontVariantNumeric:"tabular-nums"}}>{it.daysOverdue}d</td>
                  <td style={{padding:"12px 16px",textAlign:"right",color:"#C9C7BF",fontVariantNumeric:"tabular-nums"}}>
                    {it.daysSinceCall==null?<span style={{color:"#C9C7BF"}}>never</span>:`${it.daysSinceCall}d`}
                    {it.calledThisWindow && <div style={{fontSize:10,color:"#43B892"}}>✓ called</div>}
                  </td>
                  <td style={{padding:"12px 16px",color:"#C9C7BF"}}>{it.phone||"—"}</td>
                  <td style={{padding:"8px 12px"}}>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <input value={noteVal} onChange={e=>setNoteEdits(p=>({...p,[it.invoiceId]:e.target.value}))}
                        placeholder="Add note…" style={{flex:1,padding:"5px 8px",fontSize:12,borderRadius:6,border:"0.5px solid #2A2A30",minWidth:120}} />
                      {dirty && <CCBtn variant="blue" style={{padding:"5px 11px",fontSize:11.5}} onClick={()=>saveNote(it.invoiceId)} disabled={savingNote===it.invoiceId}>{savingNote===it.invoiceId?"…":"Save"}</CCBtn>}
                    </div>
                    {it.lastNote && (
                      <div style={{marginTop:3}}>
                        <button onClick={()=>setExpanded(p=>({...p,[it.invoiceId]:!p[it.invoiceId]}))}
                          style={{fontSize:10,color:"#C9C7BF",background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"}}>
                          {expanded[it.invoiceId] ? "▼ hide notes" : `▶ Last: ${it.lastNote.text.slice(0,30)}${it.lastNote.text.length>30?"…":""} (${fmtDate(it.lastNote.date)})${it.noteCount>1?` +${it.noteCount-1} more`:""}`}
                        </button>
                        {expanded[it.invoiceId] && (
                          <div style={{marginTop:4,padding:8,background:"#232329",borderRadius:6,border:"0.5px solid #2A2A30",maxWidth:340}}>
                            {(it.allNotes||[]).map((n:any,idx:number)=>(
                              <div key={idx} style={{fontSize:11,color:"#F0EEE8",paddingBottom:6,marginBottom:6,borderBottom:idx<(it.allNotes.length-1)?"0.5px solid #2A2A30":"none"}}>
                                <div style={{whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{n.text||<span style={{color:"#63615A"}}>(no text)</span>}</div>
                                <div style={{fontSize:10,color:"#63615A",marginTop:2}}>
                                  {fmtDate(n.date)}{n.status?` · ${n.status}`:""}{n.promisedAmount?` · promised ${money(n.promisedAmount)}`:""}{n.promisedDate?` by ${fmtDate(n.promisedDate)}`:""}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{padding:"12px 16px"}}>
                    <div style={{display:"flex",gap:6,whiteSpace:"nowrap"}}>
                      <CCBtn variant="blue" style={{padding:"5px 12px",fontSize:12}} onClick={()=>setCallModal(it)}>Mark Called</CCBtn>
                      <CCBtn variant="danger" style={{padding:"5px 12px",fontSize:12}} onClick={()=>setMoveModal(it)}>Move To</CCBtn>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{padding:40,textAlign:"center",fontSize:13,color:"#908E85",background:"#1C1C21",borderRadius:12,border:"0.5px solid #2A2A30"}}>
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
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(2px)",zIndex:2000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 24px",overflowY:"auto"}}>
      <div style={{background:"#1C1C21",borderRadius:14,width:"100%",maxWidth:460,padding:24}}>
        <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>Log call — {item.customerName}</div>
        <div style={{fontSize:12,color:"#908E85",marginBottom:16}}>{item.serviceType||""} · ${Math.round(item.outstanding).toLocaleString()} outstanding · {item.daysOverdue}d overdue</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <label style={{fontSize:12,color:"#C9C7BF"}}>Outcome
            <select value={status} onChange={e=>setStatus(e.target.value)} style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #2A2A30",fontSize:13}}>
              {OUTCOMES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{fontSize:12,color:"#C9C7BF"}}>Note
            <textarea value={text} onChange={e=>setText(e.target.value)} rows={3} placeholder="What happened on the call…" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #2A2A30",fontSize:13,resize:"vertical"}} />
          </label>
          {status==="PAYMENT_PROMISED" && (
            <div style={{display:"flex",gap:10}}>
              <label style={{fontSize:12,color:"#C9C7BF",flex:1}}>Promised $
                <input value={promisedAmount} onChange={e=>setPromisedAmount(e.target.value)} type="number" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #2A2A30",fontSize:13}} />
              </label>
              <label style={{fontSize:12,color:"#C9C7BF",flex:1}}>By date
                <input value={promisedDate} onChange={e=>setPromisedDate(e.target.value)} type="date" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #2A2A30",fontSize:13}} />
              </label>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"0.5px solid #2A2A30",background:"#1C1C21",cursor:"pointer"}}>Cancel</button>
          <button onClick={save} disabled={saving||!text.trim()} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#5B9BE0",color:"#1C1C21",fontWeight:500,cursor:"pointer",opacity:(saving||!text.trim())?0.6:1}}>{saving?"Saving…":"Log Call"}</button>
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
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(2px)",zIndex:2000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 24px",overflowY:"auto"}}>
      <div style={{background:"#1C1C21",borderRadius:14,width:"100%",maxWidth:420,padding:24}}>
        <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>Move — {item.customerName}</div>
        <div style={{fontSize:12,color:"#908E85",marginBottom:16}}>${Math.round(item.outstanding).toLocaleString()} outstanding · removes from the call sheet</div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <label style={{fontSize:12,color:"#C9C7BF"}}>Move to
            <select value={stage} onChange={e=>setStage(e.target.value as any)} style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #2A2A30",fontSize:13}}>
              {STAGES.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label style={{fontSize:12,color:"#C9C7BF"}}>Note (optional)
            <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} placeholder="Reason for moving…" style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"0.5px solid #2A2A30",fontSize:13,resize:"vertical"}} />
          </label>
        </div>
        <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"0.5px solid #2A2A30",background:"#1C1C21",cursor:"pointer"}}>Cancel</button>
          <button onClick={move} disabled={saving} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#E57C7C",color:"#1C1C21",fontWeight:500,cursor:"pointer",opacity:saving?0.6:1}}>{saving?"Moving…":"Move"}</button>
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
  const [paidFilter,setPaidFilter]=useState<"all"|"unpaid"|"paid">("all");
  const [callModal,setCallModal]=useState<any>(null);
  const [savingAssign,setSavingAssign]=useState<string|null>(null);
  const [distModal,setDistModal]=useState(false);
  const [sortBy,setSortBy]=useState<"overdue"|"outstanding"|"lastCall">("overdue");
  const [sortDir,setSortDir]=useState<"asc"|"desc">("desc");
  const [calledFilter,setCalledFilter]=useState<"all"|"notyet"|"called">("all");
  const [expanded,setExpanded]=useState<Record<string,boolean>>({});

  const load=useCallback(()=>{
    setLoadingB(true);
    const params=new URLSearchParams({office:officeFilter||'All'});
    if(assigneeFilter!=='all') params.set('assignee',assigneeFilter);
    if(paidFilter!=='all') params.set('paid',paidFilter);
    fetch(`/api/ar/blitz?${params}`).then(r=>r.json()).then(d=>{setData(d);setLoadingB(false);}).catch(()=>setLoadingB(false));
  },[officeFilter,assigneeFilter,paidFilter]);
  useEffect(()=>{load();},[load]);

  const money=(n:number)=>'$'+Math.round(n).toLocaleString();
  const users=data?.assignableUsers||[];
  // Blitz assignment is collapsed to 4 buckets: Mark, Vicki, Felly, and "CSRs" (= the shared
  // unassigned pool the rotating CSR works). Individual CSR names are hidden from the dropdown, but
  // tracking still logs whoever actually works an account by their own login.
  const CORE_USERNAMES=['mpaulo','vcarry','fcarreto'];
  const coreUsers=users.filter((u:any)=>CORE_USERNAMES.includes((u.username||'').toLowerCase())
    || ['Mark Paulo','Vicki Carry','Felly Carreto'].includes(u.name));

  const assign=async(invoiceId:string,userId:string)=>{
    setSavingAssign(invoiceId);
    await fetch('/api/ar/blitz',{method:'PATCH',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({invoiceId,blitzAssignedTo:userId||null})});
    setSavingAssign(null);
    load();
  };

  if(loadingB) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"#908E85"}}>Loading blitz backlog…</div>;

  const allItems=data?.items||[];
  const items=allItems.filter((it:any)=>{
    const ms=!search.trim()||(it.customerName||'').toLowerCase().includes(search.toLowerCase());
    const mv=svcFilter==="all"||it.serviceCategory===svcFilter;
    const mc=calledFilter==="all"||(calledFilter==="called"?it.calledEver:!it.calledEver);
    return ms&&mv&&mc;
  }).sort((a:any,b:any)=>{
    const dir=sortDir==="asc"?1:-1;
    if(sortBy==="outstanding") return (a.outstanding-b.outstanding)*dir;
    if(sortBy==="lastCall"){
      const av=a.daysSinceCall==null?Number.POSITIVE_INFINITY:a.daysSinceCall;
      const bv=b.daysSinceCall==null?Number.POSITIVE_INFINITY:b.daysSinceCall;
      return (av-bv)*dir;
    }
    return (a.daysOverdue-b.daysOverdue)*dir;
  });
  const shownOutstanding=items.reduce((s:number,i:any)=>s+i.outstanding,0);
  const toggleSort=(col:"overdue"|"outstanding"|"lastCall")=>{ if(sortBy===col){setSortDir(d=>d==="asc"?"desc":"asc");} else {setSortBy(col);setSortDir("desc");} };
  const sortArrow=(col:string)=> sortBy===col?(sortDir==="asc"?" ▲":" ▼"):"";
  const notYetCount=allItems.filter((it:any)=>!it.calledEver).length;

  return (
    <div>
      <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:6}}>
        <div style={{fontSize:15,fontWeight:600,color:"#F0EEE8"}}>AR Blitz — Full Backlog</div>
        <div style={{fontSize:13,color:"#908E85"}}>{data?.unpaidCount??items.length} unpaid · {data?.paidCount??0} paid · {money(shownOutstanding)} outstanding</div>
      </div>
      <div style={{fontSize:12,color:"#63615A",marginBottom:16}}>Every overdue invoice. Assign blocks to callers and work it down. (Separate from the regular cadence Call Sheet.)
        {data?.isAdmin && <button onClick={()=>setDistModal(true)} style={{marginLeft:12,padding:"5px 12px",fontSize:12,borderRadius:7,border:"0.5px solid #5B9BE0",background:"#1C1C21",color:"#5B9BE0",fontWeight:500,cursor:"pointer"}}>Auto-distribute</button>}
        {data?.isAdmin && <button onClick={async()=>{ if(!confirm("Rebuild the blitz list from today's overdue invoices? This CLEARS the current list (including paid + assignments) and creates a fresh frozen snapshot. New invoices after today won't auto-add.")) return; const r=await fetch('/api/ar/blitz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'rebuild'})}); const d=await r.json(); if(r.ok){showToast&&showToast(`List rebuilt — ${d.members} invoices`);load();} else {alert(d.error||'Rebuild failed');} }} style={{marginLeft:8,padding:"5px 12px",fontSize:12,borderRadius:7,border:"0.5px solid #DBA14E",background:"#1C1C21",color:"#DBA14E",fontWeight:500,cursor:"pointer"}}>Rebuild list</button>}
        {data?.isAdmin && <button onClick={async()=>{ if(!confirm("Add a new batch to the blitz? This KEEPS everyone already on the list (and their assignments) and adds any currently-overdue invoices that aren't on it yet.")) return; const r=await fetch('/api/ar/blitz',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'append'})}); const d=await r.json(); if(r.ok){showToast&&showToast(`Added ${d.appended} new — ${d.totalMembers} total`);load();} else {alert(d.error||'Append failed');} }} style={{marginLeft:8,padding:"5px 12px",fontSize:12,borderRadius:7,border:"0.5px solid #128a3f",background:"#1C1C21",color:"#128a3f",fontWeight:500,cursor:"pointer"}}>Add new batch</button>}
      </div>

      <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer…"
          style={{padding:"7px 12px",fontSize:13,borderRadius:8,border:"0.5px solid #2A2A30",minWidth:200}} />
        <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#232329",border:"0.5px solid #2A2A30"}}>
          {(["all","Pest Control","Wildlife"] as const).map(s=>(
            <button key={s} onClick={()=>setSvcFilter(s)} style={{padding:"6px 10px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:svcFilter===s?"0.5px solid #2A2A30":"0.5px solid transparent",background:svcFilter===s?"#1C1C21":"transparent",color:svcFilter===s?"#F0EEE8":"#908E85"}}>{s==="all"?"All":s}</button>
          ))}
        </div>
        <select value={assigneeFilter} onChange={e=>setAssigneeFilter(e.target.value)} style={{padding:"7px 10px",fontSize:12,borderRadius:8,border:"0.5px solid #2A2A30"}}>
          <option value="all">Everyone</option>
          <option value="unassigned">CSRs (pool)</option>
          {coreUsers.map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#232329",border:"0.5px solid #2A2A30"}}>
          {(["all","unpaid","paid"] as const).map(s=>(
            <button key={s} onClick={()=>setPaidFilter(s)} style={{padding:"6px 10px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:paidFilter===s?"0.5px solid #2A2A30":"0.5px solid transparent",background:paidFilter===s?"#1C1C21":"transparent",color:paidFilter===s?"#F0EEE8":"#908E85"}}>{s==="all"?"All":s==="unpaid"?"Unpaid":"Paid"}</button>
          ))}
        </div>
        <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#232329",border:"0.5px solid #2A2A30"}}>
          {([["all","All"],["notyet","Not called yet"],["called","Called"]] as const).map(([v,label])=>(
            <button key={v} onClick={()=>setCalledFilter(v as any)} style={{padding:"6px 10px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:calledFilter===v?"0.5px solid #2A2A30":"0.5px solid transparent",background:calledFilter===v?"#1C1C21":"transparent",color:calledFilter===v?(v==="notyet"?"#E57C7C":"#F0EEE8"):"#908E85"}}>{label}{v==="notyet"&&notYetCount>0?` (${notYetCount})`:""}</button>
          ))}
        </div>
      </div>

      {items.length>0 ? (
        <div style={{background:"#1C1C21",borderRadius:12,border:"0.5px solid #2A2A30",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{color:"#908E85",textAlign:"left"}}>
                <th style={{padding:"10px 12px",fontWeight:500}}>Customer</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Service</th>
                <th onClick={()=>toggleSort("outstanding")} style={{padding:"10px 12px",fontWeight:500,textAlign:"right",cursor:"pointer",userSelect:"none",color:sortBy==="outstanding"?"#5B9BE0":"#908E85"}}>Outstanding{sortArrow("outstanding")}</th>
                <th onClick={()=>toggleSort("overdue")} style={{padding:"10px 12px",fontWeight:500,textAlign:"right",cursor:"pointer",userSelect:"none",color:sortBy==="overdue"?"#5B9BE0":"#908E85"}}>Days Overdue{sortArrow("overdue")}</th>
                <th onClick={()=>toggleSort("lastCall")} style={{padding:"10px 12px",fontWeight:500,textAlign:"right",cursor:"pointer",userSelect:"none",color:sortBy==="lastCall"?"#5B9BE0":"#908E85"}}>Last Call{sortArrow("lastCall")}</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Phone</th>
                <th style={{padding:"10px 12px",fontWeight:500}}>Assigned To</th>
                <th style={{padding:"10px 12px",fontWeight:500,minWidth:160}}>Note</th>
                <th style={{padding:"10px 12px",fontWeight:500}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it:any)=>(
                <tr key={it.invoiceId} style={{borderTop:"0.5px solid #232329",opacity:it.paid?0.6:1,background:it.paid?"#F7FBF8":"transparent"}}>
                  <td style={{padding:"10px 12px",fontWeight:500,color:"#F0EEE8"}}>
                    {it.customerName}
                    {it.paid && <span style={{marginLeft:8,fontSize:10,fontWeight:600,padding:"2px 7px",borderRadius:6,background:"#DCF2E6",color:"#1D7A50"}}>PAID</span>}
                    <div style={{fontSize:11,color:"#63615A"}}>{it.serviceAddr||""}</div>
                  </td>
                  <td style={{padding:"10px 12px"}}><span style={{fontSize:11,padding:"2px 7px",borderRadius:6,background:it.serviceCategory==="Wildlife"?"#143229":"#15263a",color:it.serviceCategory==="Wildlife"?"#43B892":"#5B9BE0"}}>{it.serviceCategory}</span></td>
                  <td style={{padding:"10px 12px",textAlign:"right",fontWeight:600,color:"#E57C7C"}}>{money(it.outstanding)}</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:it.daysOverdue>=90?"#E57C7C":it.daysOverdue>=30?"#DBA14E":"#C9C7BF"}}>{it.daysOverdue}d</td>
                  <td style={{padding:"10px 12px",textAlign:"right",color:"#C9C7BF"}}>
                    {it.daysSinceCall==null?<span style={{color:"#C9C7BF"}}>never</span>:`${it.daysSinceCall}d`}
                  </td>
                  <td style={{padding:"10px 12px",color:"#C9C7BF"}}>{it.phone||"—"}</td>
                  <td style={{padding:"8px 12px"}}>
                    <select value={it.assignedTo||""} onChange={e=>assign(it.invoiceId,e.target.value)} disabled={savingAssign===it.invoiceId}
                      style={{padding:"5px 8px",fontSize:12,borderRadius:6,border:"0.5px solid #2A2A30",background:it.assignedTo?"#15263a":"#1C1C21",maxWidth:130}}>
                      <option value="">CSRs (pool)</option>
                      {coreUsers.map((u:any)=><option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </td>
                  <td style={{padding:"10px 12px",color:"#908E85",maxWidth:200}}>
                    {it.arNote && <div style={{fontSize:11,color:"#C9C7BF"}} title={it.arNote}>{it.arNote.slice(0,40)}{it.arNote.length>40?"…":""}</div>}
                    {it.lastNote ? (
                      <div style={{marginTop:2}}>
                        <button onClick={()=>setExpanded(p=>({...p,[it.invoiceId]:!p[it.invoiceId]}))}
                          style={{fontSize:10,color:"#C9C7BF",background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"}}>
                          {expanded[it.invoiceId]?"▼ hide notes":`▶ Last: ${it.lastNote.text?`${it.lastNote.text.slice(0,30)}${it.lastNote.text.length>30?"…":""} `:""}(${new Date(it.lastNote.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})})${it.noteCount>1?` +${it.noteCount-1} more`:""}`}
                        </button>
                        {expanded[it.invoiceId] && (
                          <div style={{marginTop:4,padding:8,background:"#232329",borderRadius:6,border:"0.5px solid #2A2A30",maxWidth:340}}>
                            {(it.allNotes||[]).map((n:any,idx:number)=>(
                              <div key={idx} style={{fontSize:11,color:"#F0EEE8",paddingBottom:6,marginBottom:6,borderBottom:idx<(it.allNotes.length-1)?"0.5px solid #2A2A30":"none"}}>
                                <div style={{whiteSpace:"pre-wrap",wordBreak:"break-word"}}>{n.text||<span style={{color:"#63615A"}}>(no text)</span>}</div>
                                <div style={{fontSize:10,color:"#63615A",marginTop:2}}>
                                  {new Date(n.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}{n.status?` · ${n.status}`:""}{n.promisedAmount?` · promised ${money(n.promisedAmount)}`:""}{n.promisedDate?` by ${new Date(n.promisedDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`:""}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (!it.arNote && <span style={{color:"#C9C7BF",fontSize:11}}>—</span>)}
                  </td>
                  <td style={{padding:"10px 12px"}}><button onClick={()=>setCallModal(it)} style={{background:"#5B9BE0",color:"#1C1C21",border:"none",padding:"5px 12px",borderRadius:7,fontSize:12,fontWeight:500,cursor:"pointer",whiteSpace:"nowrap"}}>Mark Called</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{padding:40,textAlign:"center",fontSize:13,color:"#908E85",background:"#1C1C21",borderRadius:12,border:"0.5px solid #2A2A30"}}>
          {allItems.length===0?"No overdue invoices. Backlog clear \uD83C\uDF89":"No matches for the current filters."}
        </div>
      )}

      {callModal && <MarkCalledModal item={callModal} onClose={()=>setCallModal(null)} onSaved={()=>{setCallModal(null);load();showToast&&showToast("Call logged");}} />}
      {distModal && <DistributeModal users={coreUsers} officeFilter={officeFilter} onClose={()=>setDistModal(false)} onDone={(res:any)=>{setDistModal(false);load();showToast&&showToast(`Distributed ${res.distributed} invoices`);}} />}
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
  const [caps,setCaps]=useState<Record<string,string>>({});
  const [running,setRunning]=useState(false);
  const [result,setResult]=useState<any>(null);

  const chosen=(users||[]).filter((u:any)=>selected[u.id]);

  const run=async()=>{
    setRunning(true);
    const capsNum: Record<string,number> = {};
    chosen.forEach((u:any)=>{ const n=parseInt(caps[u.id]); if(n>0) capsNum[u.id]=n; });
    const res=await fetch('/api/ar/blitz',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({userIds:chosen.map((u:any)=>u.id),office:officeFilter||'All',scope,caps:capsNum})});
    const data=await res.json();
    setRunning(false);
    if(res.ok){ setResult(data); }
    else { showToastFallback(data?.error); }
  };
  const showToastFallback=(msg:string)=>alert(msg||'Failed');

  return (
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(2px)",zIndex:2000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 24px",overflowY:"auto"}}>
      <div style={{background:"#1C1C21",borderRadius:14,width:"100%",maxWidth:520,padding:24,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{fontWeight:600,fontSize:16,marginBottom:4}}>Auto-distribute backlog</div>
        <div style={{fontSize:12,color:"#908E85",marginBottom:16}}>Spreads the overdue backlog evenly across the selected people, balanced within each aging bucket (1-30 / 31-60 / 61-90 / 91-180 / 181+).</div>

        {!result ? (<>
          <div style={{fontSize:12,color:"#C9C7BF",marginBottom:8}}>How many each (leave blank for no limit; rest stays in the CSR pool)</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
            {chosen.map((u:any)=>(
              <div key={u.id} style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:13,minWidth:120}}>{u.name}</span>
                <input type="number" value={caps[u.id]||""} onChange={e=>setCaps(p=>({...p,[u.id]:e.target.value}))} placeholder="e.g. 150"
                  style={{padding:"6px 10px",fontSize:13,borderRadius:8,border:"0.5px solid #2A2A30",width:100}} />
              </div>
            ))}
            <span style={{fontSize:11,color:"#63615A"}}>Each person's slice is spread evenly across all aging (newest to oldest), and so is the leftover CSR pool.</span>
          </div>

          <div style={{fontSize:12,color:"#C9C7BF",marginBottom:8}}>Scope</div>
          <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#232329",border:"0.5px solid #2A2A30",marginBottom:16}}>
            <button onClick={()=>setScope("all")} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:scope==="all"?"0.5px solid #2A2A30":"0.5px solid transparent",background:scope==="all"?"#1C1C21":"transparent",color:scope==="all"?"#F0EEE8":"#908E85"}}>Reshuffle all</button>
            <button onClick={()=>setScope("unassigned")} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:scope==="unassigned"?"0.5px solid #2A2A30":"0.5px solid transparent",background:scope==="unassigned"?"#1C1C21":"transparent",color:scope==="unassigned"?"#F0EEE8":"#908E85"}}>Only unassigned</button>
          </div>

          <div style={{fontSize:12,color:"#C9C7BF",marginBottom:8}}>People ({chosen.length} selected)</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:18}}>
            {(users||[]).map((u:any)=>(
              <label key={u.id} style={{display:"flex",alignItems:"center",gap:7,fontSize:13,padding:"5px 8px",borderRadius:7,background:selected[u.id]?"#15263a":"#232329",cursor:"pointer"}}>
                <input type="checkbox" checked={!!selected[u.id]} onChange={e=>setSelected(p=>({...p,[u.id]:e.target.checked}))} />
                {u.name}
              </label>
            ))}
          </div>

          <div style={{background:"#FBF6E9",border:"0.5px solid #E8DCC0",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#8A6D1E",marginBottom:16}}>
            {scope==="all"?"Reshuffle all will reassign every invoice \u2014 including ones already assigned or in progress.":"Only unassigned will keep existing assignments and distribute the rest."}
          </div>

          <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"0.5px solid #2A2A30",background:"#1C1C21",cursor:"pointer"}}>Cancel</button>
            <button onClick={run} disabled={running||chosen.length===0} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#5B9BE0",color:"#1C1C21",fontWeight:500,cursor:"pointer",opacity:(running||chosen.length===0)?0.6:1}}>{running?"Distributing\u2026":`Distribute to ${chosen.length}`}</button>
          </div>
        </>) : (<>
          <div style={{fontSize:13,color:"#F0EEE8",marginBottom:12}}>Distributed <b>{result.distributed}</b> invoices.</div>
          <div style={{fontSize:12,color:"#C9C7BF",marginBottom:8}}>By bucket: 1-30: {result.buckets['1-30']} · 31-60: {result.buckets['31-60']} · 61-90: {result.buckets['61-90']} · 91-180: {result.buckets['91-180']} · 181+: {result.buckets['181+']}</div>
          <div style={{display:"flex",justifyContent:"flex-end",marginTop:16}}>
            <button onClick={()=>onDone(result)} style={{fontSize:13,padding:"8px 16px",borderRadius:8,border:"none",background:"#5B9BE0",color:"#1C1C21",fontWeight:500,cursor:"pointer"}}>Done</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

function RepDetailBlock({title, rows, kind, money, fmtDT, showRep}: any) {
  const th:any={padding:"7px 10px",fontWeight:500,textAlign:"left",color:"#908E85",fontSize:11};
  const td:any={padding:"7px 10px",fontSize:12,color:"#F0EEE8"};
  return (
    <div>
      <div style={{fontSize:12,fontWeight:600,color:"#C9C7BF",marginBottom:6}}>{title}</div>
      {rows.length===0 ? <div style={{fontSize:12,color:"#63615A",padding:"4px 0"}}>None in this window.</div> : (
        <div style={{background:"#1C1C21",borderRadius:10,border:"0.5px solid #2A2A30",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            {kind==="collections" && <>
              <thead><tr>{showRep&&<th style={th}>Rep</th>}<th style={th}>Customer</th><th style={{...th,textAlign:"right"}}>Amount</th><th style={th}>Date</th><th style={th}>Source</th><th style={th}>Credited</th></tr></thead>
              <tbody>{rows.map((r:any,i:number)=>(<tr key={i} style={{borderTop:"0.5px solid #232329"}}>{showRep&&<td style={td}>{r.rep}</td>}<td style={td}>{r.customer}</td><td style={{...td,textAlign:"right",fontWeight:600,color:"#43B892"}}>{money(r.amount)}</td><td style={td}>{fmtDT(r.date)}</td><td style={td}>{r.source}</td><td style={td}>{r.credited?"✓":<span style={{color:"#63615A"}}>self-serve</span>}</td></tr>))}</tbody>
            </>}
            {kind==="calls" && <>
              <thead><tr>{showRep&&<th style={th}>Rep</th>}<th style={th}>Customer</th><th style={th}>Number</th><th style={th}>Date</th><th style={th}>Duration</th><th style={th}>State</th></tr></thead>
              <tbody>{rows.map((r:any,i:number)=>(<tr key={i} style={{borderTop:"0.5px solid #232329"}}>{showRep&&<td style={td}>{r.rep}</td>}<td style={td}>{r.customer||"—"}</td><td style={td}>{r.phone}</td><td style={td}>{fmtDT(r.date)}</td><td style={td}>{Math.floor((r.durationSec||0)/60)}m {(r.durationSec||0)%60}s</td><td style={td}>{r.state}</td></tr>))}</tbody>
            </>}
            {kind==="notes" && <>
              <thead><tr>{showRep&&<th style={th}>Rep</th>}<th style={th}>Customer</th><th style={th}>Date</th><th style={th}>Outcome</th><th style={th}>Note</th></tr></thead>
              <tbody>{rows.map((r:any,i:number)=>(<tr key={i} style={{borderTop:"0.5px solid #232329"}}>{showRep&&<td style={td}>{r.rep}</td>}<td style={td}>{r.customer}</td><td style={td}>{fmtDT(r.date)}</td><td style={td}>{r.status}</td><td style={{...td,color:"#C9C7BF"}}>{r.text}</td></tr>))}</tbody>
            </>}
          </table>
        </div>
      )}
    </div>
  );
}

function TrackingPage() {
  const [tab,setTab]=useState<"leaderboard"|"activity"|"failsafe">("leaderboard");
  const [range]=useState<"all">("all");
  const [lb,setLb]=useState<any>(null);
  const [fs,setFs]=useState<any>(null);
  const [fsAllowed,setFsAllowed]=useState(false);
  const [loading,setLoading]=useState(true);
  const [expanded,setExpanded]=useState<string|null>(null); // userId whose detail is open
  const [detail,setDetail]=useState<Record<string,any>>({}); // userId -> detail payload
  const [activity,setActivity]=useState<any>(null);

  const money=(n:number)=>'$'+Math.round(n).toLocaleString();
  const fmtDT=(d:string)=>new Date(d).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

  const toggleRep=(userId:string)=>{
    if(expanded===userId){ setExpanded(null); return; }
    setExpanded(userId);
    if(!detail[userId]){
      fetch(`/api/ar/tracking?view=detail&userId=${userId}&range=${range}`).then(r=>r.json())
        .then(d=>setDetail(p=>({...p,[userId]:d}))).catch(()=>{});
    }
  };

  useEffect(()=>{
    setLoading(true);
    setDetail({}); setExpanded(null);
    fetch(`/api/ar/tracking?view=leaderboard&range=${range}`).then(r=>r.json()).then(d=>{setLb(d);setLoading(false);}).catch(()=>setLoading(false));
    fetch(`/api/ar/tracking?view=activity&range=${range}`).then(r=>r.json()).then(d=>setActivity(d)).catch(()=>{});
    // Attempt fail-safe; only admins get 200. If allowed, reveal the toggle.
    fetch(`/api/ar/tracking?view=failsafe&range=${range}`).then(async r=>{
      if(r.ok){ setFsAllowed(true); setFs(await r.json()); } else { setFsAllowed(false); }
    }).catch(()=>setFsAllowed(false));
  },[range]);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <div style={{fontSize:15,fontWeight:600,color:"#F0EEE8"}}>AR Tracking</div>
        <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#232329",border:"0.5px solid #2A2A30"}}>
          <button onClick={()=>setTab("leaderboard")} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:tab==="leaderboard"?"0.5px solid #2A2A30":"0.5px solid transparent",background:tab==="leaderboard"?"#1C1C21":"transparent",color:tab==="leaderboard"?"#F0EEE8":"#908E85"}}>Leaderboard</button>
          <button onClick={()=>setTab("activity")} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:tab==="activity"?"0.5px solid #2A2A30":"0.5px solid transparent",background:tab==="activity"?"#1C1C21":"transparent",color:tab==="activity"?"#F0EEE8":"#908E85"}}>Activity Log</button>
          {fsAllowed && <button onClick={()=>setTab("failsafe")} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:tab==="failsafe"?"0.5px solid #2A2A30":"0.5px solid transparent",background:tab==="failsafe"?"#1C1C21":"transparent",color:tab==="failsafe"?"#E57C7C":"#908E85"}}>Fail-safe audit</button>}
        </div>
        <div style={{marginLeft:"auto",fontSize:11,color:"#63615A"}}>All activity since blitz start</div>
      </div>

      {loading ? <div style={{padding:40,textAlign:"center",fontSize:13,color:"#908E85"}}>Loading…</div> : tab==="leaderboard" ? (
        <div>
          <div style={{display:"flex",gap:16,marginBottom:14,fontSize:12,color:"#C9C7BF"}}>
            <span>Credited to reps: <b style={{color:"#43B892"}}>{money(lb?.creditedTotal||0)}</b></span>
            <span>Self-serve (portal/ACH/check, no credit): <b>{money(lb?.selfServeTotal||0)}</b></span>
          </div>
          <div style={{background:"#1C1C21",borderRadius:12,border:"0.5px solid #2A2A30",overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{color:"#908E85",textAlign:"left"}}>
                <th style={{padding:"10px 14px",fontWeight:500}}>#</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Rep</th>
                <th style={{padding:"10px 14px",fontWeight:500,textAlign:"right"}}>Collected</th>
                <th style={{padding:"10px 14px",fontWeight:500,textAlign:"right"}}>Payments</th>
                <th style={{padding:"10px 14px",fontWeight:500,textAlign:"right"}}>Calls</th>
              </tr></thead>
              <tbody>
                {(lb?.board||[]).map((r:any,i:number)=>(
                  <Fragment key={r.userId}>
                  <tr onClick={()=>toggleRep(r.userId)} style={{borderTop:"0.5px solid #232329",cursor:"pointer",background:expanded===r.userId?"#232329":"transparent"}}>
                    <td style={{padding:"10px 14px",color:"#63615A"}}>{expanded===r.userId?"▾":"▸"} {i+1}</td>
                    <td style={{padding:"10px 14px",fontWeight:500,color:"#F0EEE8"}}>{r.name}{!r.mapped && <span title="No FieldRoutes employee mapping — collections can't be credited yet" style={{marginLeft:6,fontSize:10,color:"#DBA14E"}}>⚠ unmapped</span>}</td>
                    <td style={{padding:"10px 14px",textAlign:"right",fontWeight:600,color:"#43B892"}}>{money(r.collected)}</td>
                    <td style={{padding:"10px 14px",textAlign:"right",color:"#C9C7BF"}}>{r.paymentsProcessed}</td>
                    <td style={{padding:"10px 14px",textAlign:"right",color:"#C9C7BF"}}>{r.calls}</td>
                  </tr>
                  {expanded===r.userId && (
                    <tr><td colSpan={5} style={{padding:"0 14px 14px",background:"#232329"}}>
                      {!detail[r.userId] ? <div style={{padding:12,fontSize:12,color:"#908E85"}}>Loading detail…</div> : (
                        <div style={{display:"flex",flexDirection:"column",gap:14,paddingTop:10}}>
                          <RepDetailBlock title={`Collections (${detail[r.userId].collections.length})`} rows={detail[r.userId].collections} kind="collections" money={money} fmtDT={fmtDT} />
                          <RepDetailBlock title={`Calls (${detail[r.userId].calls.length})`} rows={detail[r.userId].calls} kind="calls" money={money} fmtDT={fmtDT} />
                          <RepDetailBlock title={`Logged notes (${detail[r.userId].notes.length})`} rows={detail[r.userId].notes} kind="notes" money={money} fmtDT={fmtDT} />
                        </div>
                      )}
                    </td></tr>
                  )}
                  </Fragment>
                ))}
                {(lb?.board||[]).length===0 && <tr><td colSpan={5} style={{padding:30,textAlign:"center",color:"#908E85"}}>No activity in this window yet.</td></tr>}
              </tbody>
            </table>
          </div>
          {lb?.unmappedUsers?.length>0 && <div style={{marginTop:10,fontSize:11,color:"#DBA14E"}}>Not yet credit-eligible (need FieldRoutes employee mapping): {lb.unmappedUsers.join(', ')}</div>}
        </div>
      ) : tab==="activity" ? (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <RepDetailBlock title={`Collections (${activity?.collections?.length||0})`} rows={activity?.collections||[]} kind="collections" money={money} fmtDT={fmtDT} showRep />
          <RepDetailBlock title={`Calls (${activity?.calls?.length||0})`} rows={activity?.calls||[]} kind="calls" money={money} fmtDT={fmtDT} showRep />
          <RepDetailBlock title={`Logged notes (${activity?.notes?.length||0})`} rows={activity?.notes||[]} kind="notes" money={money} fmtDT={fmtDT} showRep />
        </div>
      ) : (
        <div>
          <div style={{background:"#F6EAEA",border:"0.5px solid #E0C4C4",borderRadius:8,padding:"8px 12px",fontSize:11,color:"#E57C7C",marginBottom:14}}>Admin-only. Flags logged calls with no matching Dial Pad call to the customer's number. {fs?.flaggedCount||0} of {fs?.checked||0} logged calls flagged.</div>
          <div style={{background:"#1C1C21",borderRadius:12,border:"0.5px solid #2A2A30",overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead><tr style={{color:"#908E85",textAlign:"left"}}>
                <th style={{padding:"10px 14px",fontWeight:500}}>Date</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Customer</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Logged by</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Phone</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Note</th>
              </tr></thead>
              <tbody>
                {(fs?.flagged||[]).map((f:any)=>(
                  <tr key={f.noteId} style={{borderTop:"0.5px solid #232329"}}>
                    <td style={{padding:"10px 14px",color:"#C9C7BF"}}>{new Date(f.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</td>
                    <td style={{padding:"10px 14px",fontWeight:500,color:"#F0EEE8"}}>{f.customerName}</td>
                    <td style={{padding:"10px 14px",color:"#E57C7C"}}>{f.loggedBy}</td>
                    <td style={{padding:"10px 14px",color:"#C9C7BF"}}>{f.phone}</td>
                    <td style={{padding:"10px 14px",color:"#908E85"}}>{f.note}</td>
                  </tr>
                ))}
                {(fs?.flagged||[]).length===0 && <tr><td colSpan={5} style={{padding:30,textAlign:"center",color:"#43B892"}}>No mismatches — all logged calls have a matching Dial Pad call. ✓</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
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
  const COLOR:any={COLLECTIONS:{bg:"#15263a",fg:"#5B9BE0"},SCC:{bg:"#FBF0E4",fg:"#8A5A1E"},BAD_DEBT:{bg:"#F6EAEA",fg:"#E57C7C"}};

  const moveBack=async(invoiceId:string)=>{
    await fetch('/api/ar/call-sheet',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({invoiceId,arStage:null})});
    load(); showToast&&showToast("Moved back to call sheet");
  };

  if(loadingS) return <div style={{padding:40,textAlign:"center",fontSize:13,color:"#908E85"}}>Loading…</div>;
  const all=data?.items||[];
  const items=all.filter((it:any)=>filter==="all"||it.status===filter);

  return (
    <div>
      <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:600,color:"#F0EEE8"}}>Collections / SCC / Bad Debt</div>
        <div style={{fontSize:13,color:"#908E85"}}>{items.length} account{items.length!==1?"s":""}</div>
      </div>

      <div style={{display:"inline-flex",gap:2,padding:4,borderRadius:10,background:"#232329",border:"0.5px solid #2A2A30",marginBottom:14}}>
        {(["all","COLLECTIONS","SCC","BAD_DEBT"] as const).map(s=>(
          <button key={s} onClick={()=>setFilter(s)} style={{padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",border:filter===s?"0.5px solid #2A2A30":"0.5px solid transparent",background:filter===s?"#1C1C21":"transparent",color:filter===s?"#F0EEE8":"#908E85"}}>
            {s==="all"?"All":LABEL[s]}
          </button>
        ))}
      </div>

      {items.length>0 ? (
        <div style={{background:"#1C1C21",borderRadius:12,border:"0.5px solid #2A2A30",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{color:"#908E85",textAlign:"left"}}>
                <th style={{padding:"10px 14px",fontWeight:500}}>Customer</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Service</th>
                <th style={{padding:"10px 14px",fontWeight:500,textAlign:"right"}}>Outstanding</th>
                <th style={{padding:"10px 14px",fontWeight:500}}>Status</th>
                <th style={{padding:"10px 14px",fontWeight:500}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it:any)=>(
                <tr key={it.invoiceId} style={{borderTop:"0.5px solid #232329"}}>
                  <td style={{padding:"10px 14px",fontWeight:500,color:"#F0EEE8"}}>{it.customerName}<div style={{fontSize:11,color:"#63615A"}}>{it.serviceAddr||""}</div></td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:11,padding:"2px 7px",borderRadius:6,background:it.serviceCategory==="Wildlife"?"#143229":"#15263a",color:it.serviceCategory==="Wildlife"?"#43B892":"#5B9BE0"}}>{it.serviceCategory}</span></td>
                  <td style={{padding:"10px 14px",textAlign:"right",fontWeight:600,color:"#E57C7C"}}>{money(it.outstanding)}</td>
                  <td style={{padding:"10px 14px"}}><span style={{fontSize:11,padding:"3px 9px",borderRadius:6,fontWeight:500,background:COLOR[it.status]?.bg,color:COLOR[it.status]?.fg}}>{LABEL[it.status]}</span></td>
                  <td style={{padding:"10px 14px"}}><button onClick={()=>moveBack(it.invoiceId)} style={{background:"#1C1C21",color:"#C9C7BF",border:"0.5px solid #2A2A30",padding:"5px 10px",borderRadius:7,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>Back to sheet</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{padding:40,textAlign:"center",fontSize:13,color:"#908E85",background:"#1C1C21",borderRadius:12,border:"0.5px solid #2A2A30"}}>No accounts in this stage.</div>
      )}
    </div>
  );
}

function DashPage({open,totalAR,totalOverdue,collected,agingTotals,payments,prevMonthAR,collectedDays,setCollectedDays,customDateFrom,customDateTo,setCustomDateFrom,setCustomDateTo}: any) {
  const arVsBenchmark = prevMonthAR > 0 ? ((totalAR - prevMonthAR) / prevMonthAR) * 100 : 0;
  const openInvoices = open.length;

  return (
    <div>
      {/* Top-line AR health */}
      <CCKpiStrip items={[
        { icon:"💰", label:"Total AR", value:fmt(totalAR), tone:"blue", delta:`${openInvoices} open invoices` },
        { icon:"⏰", label:"Total past due", value:fmt(totalOverdue), tone:"red", delta: totalAR>0 ? `${Math.round((totalOverdue/totalAR)*100)}% of AR` : "" , deltaTone:"red" },
        { icon:"📄", label:"Open invoices", value:openInvoices, tone:"violet" },
        { icon:"📊", label:"AR vs last month", value:`${arVsBenchmark>=0?"+":""}${arVsBenchmark.toFixed(1)}%`, tone: arVsBenchmark>0?"red":"green", delta: arVsBenchmark>0?"above benchmark":"below benchmark", deltaTone: arVsBenchmark>0?"red":"green" },
      ]} />

      {/* Aging breakdown */}
      <CCSectionHeader note="outstanding balance by age">Aging</CCSectionHeader>
      <CCKpiStrip items={[
        { icon:"🟢", label:"1–30 days", value:fmt(agingTotals["1-30"]), tone:"green" },
        { icon:"🟡", label:"31–60 days", value:fmt(agingTotals["31-60"]), tone:"amber" },
        { icon:"🟠", label:"61–90 days", value:fmt(agingTotals["61-90"]), tone:"amber" },
        { icon:"🔴", label:"90+ days", value:fmt(agingTotals["90+"]), tone:"red" },
      ]} />

      {/* Collections performance */}
      <CCSectionHeader>Collections</CCSectionHeader>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:13}}>
        <CCCard style={{padding:"16px 17px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:"#9D8BE6",borderRadius:3}}/>
          <div style={{fontSize:12,color:"#908E85",fontWeight:500}}>AR benchmark (previous month)</div>
          <div style={{fontSize:24,fontWeight:700,marginTop:8,color:"#F0EEE8"}}>{fmt(prevMonthAR)}</div>
        </CCCard>
        <CCCard style={{padding:"16px 17px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:"#43B892",borderRadius:3}}/>
          <div style={{fontSize:12,color:"#908E85",fontWeight:500,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span>Payments collected</span>
            <select value={collectedDays} onChange={e=>setCollectedDays(Number(e.target.value))} style={{fontSize:11,padding:"2px 6px",borderRadius:6,border:"1px solid #35353C",background:"#26262C",color:"#F0EEE8"}}>
              <option value={7}>7d</option><option value={30}>30d</option><option value={60}>60d</option><option value={90}>90d</option><option value={365}>YTD</option><option value={0}>Custom</option>
            </select>
            {collectedDays===0 && (
              <div style={{display:"flex",alignItems:"center",gap:4,marginTop:4,width:"100%"}}>
                <input type="date" value={customDateFrom} onChange={e=>setCustomDateFrom(e.target.value)} style={{fontSize:10,padding:"3px 5px",borderRadius:5,border:"1px solid #35353C",background:"#26262C",color:"#F0EEE8"}}/>
                <span style={{fontSize:10,color:"#908E85"}}>to</span>
                <input type="date" value={customDateTo} onChange={e=>setCustomDateTo(e.target.value)} style={{fontSize:10,padding:"3px 5px",borderRadius:5,border:"1px solid #35353C",background:"#26262C",color:"#F0EEE8"}}/>
              </div>
            )}
          </div>
          <div style={{fontSize:24,fontWeight:700,marginTop:8,color:"#43B892"}}>{fmt(collected)}</div>
        </CCCard>
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

  const invCount=useMemo(()=>{const m:any={};enriched.forEach((i:any)=>{m[i.customerId]=(m[i.customerId]||0)+1});return m},[enriched]);

  return (
    <div>
      <CCToolbar>
        <div style={{fontSize:13,fontWeight:600,color:"#C9C7BF"}}>Customers <span style={{color:"#63615A",fontWeight:400}}>· {filtered.length}</span></div>
        <CCSearchBox value={search} onChange={(v:string)=>{setSearch(v);setCurrentPage(1);}} placeholder="Search name, phone or FR ID…" />
      </CCToolbar>
      <CCDataTable
        rowKey={(c:any)=>c.id}
        empty="No customers found"
        cols={[
          { key:"cust", label:"Customer", render:(c:any)=><div onClick={()=>setModal({type:"customerDetail",customer:c})} style={{cursor:"pointer"}}><CCCustomerCell name={c.name||"Customer"} sub={c.email||undefined}/></div> },
          { key:"phone", label:"Phone", render:(c:any)=><span style={{color:"#C9C7BF"}}>{c.phone||"—"}</span> },
          { key:"frid", label:"FR ID", render:(c:any)=><span style={{fontVariantNumeric:"tabular-nums",color:"#908E85"}}>{c.externalId||"—"}</span> },
          { key:"addr", label:"Address", render:(c:any)=><span style={{color:"#908E85",fontSize:12.5,display:"inline-block",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",verticalAlign:"bottom"}} title={c.serviceAddr||""}>{c.serviceAddr||"—"}</span> },
          { key:"ar", label:"Open AR", align:"right", render:(c:any)=><span style={{fontWeight:700,color:balBC[c.id]>0?"#F0EEE8":"#63615A",fontVariantNumeric:"tabular-nums"}}>{balBC[c.id]?fmt(balBC[c.id]):"—"}</span> },
          { key:"inv", label:"Invoices", align:"right", render:(c:any)=><span style={{color:"#908E85",fontVariantNumeric:"tabular-nums"}}>{invCount[c.id]||0}</span> },
        ]}
        rows={displayed}
      />
      <Pagination current={currentPage} total={filtered.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
    </div>
  );
}

function InvPage({enriched,setModal,showToast,loadAll,isAdmin}: any) {
  const [search,setSearch]=useState("");
  const [statusF,setStatusF]=useState("");
  const [pageSize,setPageSize]=useState(100);
  const [currentPage,setCurrentPage]=useState(1);
  const [reopening,setReopening]=useState<string|null>(null);

  const reopen=async(inv:any)=>{
    if(!confirm(`Reopen invoice ${inv.id} for ${inv.customer?.name||'this customer'}?\n\nThis sets it back to CURRENT, removes the due date, and takes it off the Call Sheet, AR Blitz, and PestAI follow-up. Use this when a project was closed by mistake and is still ongoing.`)) return;
    setReopening(inv.id);
    const r=await fetch(`/api/invoices/${inv.id}/reopen`,{method:'POST'});
    setReopening(null);
    if(r.ok){ showToast&&showToast(`Invoice ${inv.id} reopened`); loadAll(); }
    else { const d=await r.json().catch(()=>({})); alert(d.error||'Reopen failed'); }
  };

  const sorted = useMemo(()=>[...enriched].sort((a:any,b:any)=>new Date(b.date).getTime()-new Date(a.date).getTime()),[enriched]);

  const filtered=sorted.filter((i:any)=>{
    if(statusF&&i.status!==statusF)return false;
    if(search){const s=search.toLowerCase();if(!i.id?.toLowerCase().includes(s)&&!i.customer?.name?.toLowerCase().includes(s))return false;}
    return true;
  });

  const displayed=filtered.slice((currentPage-1)*pageSize,currentPage*pageSize);

  const del=async(id:string)=>{if(!confirm("Delete invoice "+id+"?"))return;await fetch(`/api/invoices/${id}`,{method:"DELETE"});showToast("Invoice deleted");loadAll();};

  const stTone:any={CURRENT:"blue",OVERDUE:"red",COLLECTIONS:"red",PAYMENT_PLAN:"amber",PAID:"green",DISPUTED:"violet"};
  return (
    <div>
      <CCToolbar>
        <div style={{fontSize:13,fontWeight:600,color:"#C9C7BF"}}>Invoices <span style={{color:"#63615A",fontWeight:400}}>· {filtered.length}</span></div>
        <select value={statusF} onChange={e=>{setStatusF(e.target.value);setCurrentPage(1);}} style={{fontSize:12.5,padding:"8px 11px",borderRadius:9,border:"1px solid #35353C",background:"#26262C",color:"#F0EEE8"}}>
          <option value="">All statuses</option>
          {["CURRENT","OVERDUE","COLLECTIONS","PAYMENT_PLAN","PAID","DISPUTED"].map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}
        </select>
        <CCSearchBox value={search} onChange={(v:string)=>{setSearch(v);setCurrentPage(1);}} placeholder="Search invoice # or customer…" />
      </CCToolbar>
      <CCDataTable
        rowKey={(inv:any)=>inv.id}
        empty="No invoices match"
        cols={[
          { key:"inv", label:"Invoice #", render:(inv:any)=><span style={{fontWeight:600,color:"#F0EEE8",fontVariantNumeric:"tabular-nums"}}>{inv.id}</span> },
          { key:"cust", label:"Customer", render:(inv:any)=><CCCustomerCell name={inv.customer?.name||"—"} /> },
          { key:"date", label:"Date", render:(inv:any)=><span style={{color:"#908E85",fontSize:12.5}}>{inv.date?.split("T")[0]}</span> },
          { key:"due", label:"Due date", render:(inv:any)=><span style={{color:inv.daysOverdue>0?"#E57C7C":"#908E85",fontSize:12.5}}>{inv.due?.split("T")[0]||"—"}</span> },
          { key:"amount", label:"Amount", align:"right", render:(inv:any)=><span style={{color:"#C9C7BF",fontVariantNumeric:"tabular-nums"}}>{fmt(Number(inv.amount))}</span> },
          { key:"balance", label:"Balance", align:"right", render:(inv:any)=><span style={{fontWeight:700,color:inv.balance>0?"#F0EEE8":"#63615A",fontVariantNumeric:"tabular-nums"}}>{fmt(inv.balance)}</span> },
          { key:"status", label:"Status", render:(inv:any)=><CCStatusPill tone={stTone[inv.status]||"neutral"}>{statusLabels[inv.status]||inv.status}</CCStatusPill> },
          { key:"act", label:"", align:"right", render:(inv:any)=>(
            <div style={{display:"flex",gap:6,justifyContent:"flex-end",alignItems:"center"}}>
              {inv.balance>0&&<CCBtn variant="secondary" style={{padding:"5px 11px",fontSize:12}} onClick={()=>setModal({type:"closeOut",invoice:inv})}>Close out</CCBtn>}
              {isAdmin && (inv.status==="OVERDUE"||inv.status==="COLLECTIONS"||inv.due) && (
                <CCBtn variant="secondary" disabled={reopening===inv.id} style={{padding:"5px 11px",fontSize:12,color:"#DBA14E",borderColor:"#4a3a1e"}} onClick={()=>reopen(inv)}>{reopening===inv.id?"…":"Reopen"}</CCBtn>
              )}
            </div>) },
        ]}
        rows={displayed}
      />
      <Pagination current={currentPage} total={filtered.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
    </div>
  );
}

function PayPage({payments,invoices,custMap,showToast,loadAll,setModal}: any) {
  const [pageSize,setPageSize]=useState(100);
  const [currentPage,setCurrentPage]=useState(1);
  // Resolve the customer name directly from the payment's own invoice->customer join (the payments API already
  // includes it). The old lookup via the loaded `invoices` list failed for PAID invoices, which are excluded
  // from that list by default — so most payments (which paid their invoice off) showed no customer name.
  const ep=payments.map((p:any)=>{
    const inv=invoices.find((i:any)=>i.id===p.invoiceId);
    const name = p.invoice?.customer?.name || (inv ? custMap[inv.customerId]?.name : null) || null;
    return {...p, customer: name ? { name } : null};
  }).sort((a:any,b:any)=>a.date>b.date?-1:1);
  const del=async(id:string)=>{if(!confirm("Delete this payment?"))return;await fetch(`/api/payments/${id}`,{method:"DELETE"});showToast("Payment deleted");loadAll();};
  const displayed=ep.slice((currentPage-1)*pageSize,currentPage*pageSize);

  return (
    <div>
      <CCToolbar>
        <div style={{fontSize:13,fontWeight:600,color:"#C9C7BF"}}>Payments <span style={{color:"#63615A",fontWeight:400}}>· {payments.length}</span></div>
      </CCToolbar>
      <CCDataTable
        rowKey={(p:any)=>p.id}
        empty="No payments yet"
        cols={[
          { key:"cust", label:"Customer", render:(p:any)=><CCCustomerCell name={p.customer?.name||"—"} /> },
          { key:"inv", label:"Invoice", render:(p:any)=><span style={{fontVariantNumeric:"tabular-nums",color:"#908E85"}}>{p.invoiceId}</span> },
          { key:"date", label:"Date", render:(p:any)=><span style={{color:"#908E85",fontSize:12.5}}>{p.date?.split("T")[0]}</span> },
          { key:"method", label:"Method", render:(p:any)=><CCStatusPill tone="blue">{p.method}</CCStatusPill> },
          { key:"amount", label:"Amount", align:"right", render:(p:any)=><span style={{fontWeight:700,color:"#43B892",fontVariantNumeric:"tabular-nums"}}>{fmt(Number(p.amount))}</span> },
          { key:"ref", label:"Reference", render:(p:any)=><span style={{fontSize:12,color:"#908E85"}}>{p.reference||"—"}</span> },
          { key:"act", label:"", align:"right", render:(p:any)=><CCBtn variant="danger" style={{padding:"4px 10px",fontSize:12}} onClick={()=>del(p.id)}>✕</CCBtn> },
        ]}
        rows={displayed}
      />
      <Pagination current={currentPage} total={ep.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
    </div>
  );
}

function AgePage({open,agingTotals,custMap}: any) {
  const [pageSize,setPageSize]=useState(100);
  const [currentPage,setCurrentPage]=useState(1);
  const [selectedBucket,setSelectedBucket]=useState<string|null>(null);

  const buckets=["current","1-30","31-60","61-90","90+"];
  const bC:any={current:"#43B892","1-30":"#43B892","31-60":"#DBA14E","61-90":"#DBA14E","90+":"#E57C7C"};
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

  const chipTone:any={current:"green","1-30":"green","31-60":"amber","61-90":"amber","90+":"red"};
  const invCountIn=(b:string)=>open.filter((i:any)=>{const d=i.daysOverdue;const bk=d<=0?"current":d<=30?"1-30":d<=60?"31-60":d<=90?"61-90":"90+";return bk===b;}).length;
  return (
    <div>
      <CCFilterChips
        active={selectedBucket===null?"__all":selectedBucket}
        onChange={(k:string)=>{setSelectedBucket(k==="__all"?null:k);setCurrentPage(1);}}
        chips={[
          ...buckets.map(b=>({ key:b, label:tileLabel(b), value:fmt((agingTotals as any)[b]), sub:`${invCountIn(b)} invoices`, valueTone:chipTone[b] })),
          { key:"__all", label:"Total AR", value:fmt(Number(total)), sub:`${open.length} invoices` },
        ]}
      />
      <CCToolbar>
        <div style={{fontSize:13,fontWeight:600,color:"#C9C7BF"}}>{selectedBucket ? `${tileLabel(selectedBucket)} customers` : "All customers"} <span style={{color:"#63615A",fontWeight:400}}>· {filtered.length}</span></div>
      </CCToolbar>
      <CCDataTable
        rowKey={(_r:any,i:number)=>String(i)}
        empty="No customers in this bucket"
        cols={[
          { key:"cust", label:"Customer", render:(r:any)=><CCCustomerCell name={r.customer?.name||"—"} /> },
          ...buckets.map(b=>({ key:b, label:tileLabel(b), align:"right" as const, render:(r:any)=><span style={{color:r[b]>0?bC[b]:"#63615A",fontWeight:r[b]>0?600:400,fontVariantNumeric:"tabular-nums"}}>{r[b]>0?fmt(r[b]):"—"}</span> })),
          { key:"total", label:"Total", align:"right" as const, render:(r:any)=><span style={{fontWeight:700,color:"#F0EEE8",fontVariantNumeric:"tabular-nums"}}>{fmt(r.total)}</span> },
        ]}
        rows={displayed}
      />
      <Pagination current={currentPage} total={filtered.length} pageSize={pageSize} onPage={setCurrentPage} onSize={(s:number)=>{setPageSize(s);setCurrentPage(1);}}/>
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
      {invoice&&<div style={{background:"#232329",borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:13}}>
        <div style={{fontWeight:500}}>{custMap[invoice.customerId]?.name} · {invoice.id}</div>
        <div style={{color:"#908E85",marginTop:2}}>Balance: <strong>{fmt(invoice.balance)}</strong></div>
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
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16,background:"#232329",borderRadius:8,padding:"12px 14px"}}>
        <div><div style={{fontSize:11,color:"#908E85"}}>Phone</div><div style={{fontSize:13}}>{c.phone||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#908E85"}}>FR ID</div><div style={{fontSize:13}}>{c.externalId||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#908E85"}}>Email</div><div style={{fontSize:13}}>{c.email||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#908E85"}}>Address</div><div style={{fontSize:13}}>{c.serviceAddr||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#908E85"}}>Office</div><div style={{fontSize:13}}>{c.office||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#908E85"}}>Open AR</div><div style={{fontSize:16,fontWeight:500,color:bal>0?"#E57C7C":"inherit"}}>{fmt(bal)}</div></div>
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
      <div style={{background:"#232329",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:13}}>
        <div style={{fontWeight:500}}>{cust?.name} · {invoice.id}</div>
        <div style={{color:"#908E85",marginTop:2}}>Amount: <strong>{fmt(Number(invoice.amount))}</strong></div>
      </div>
      <div style={{fontSize:13,color:"#F0EEE8",marginBottom:12}}>Select the close-out date. Aging starts from this date.</div>
      <Inp label="Close-out date" value={closeOutDate} onChange={setCloseOutDate} type="date"/>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={submit}>Close out invoice</Btn>
      </div>
    </Modal>
  );
}
