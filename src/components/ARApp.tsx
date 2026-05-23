"use client";
import { useState, useEffect, useMemo, useCallback } from "react";

const TODAY = new Date();
const AR_BENCHMARK = 285000;
const fmt = (n: number) => "$" + Math.round(n).toLocaleString();
const pct = (n: number) => Math.round(n * 100) + "%";
const daysDiff = (ds: string) => Math.round((TODAY.getTime() - new Date(ds).getTime()) / 86400000);

const statusLabels: Record<string, string> = { CURRENT:"Current", OVERDUE:"Overdue", COLLECTIONS:"Collections", PAID:"Paid", PAYMENT_PLAN:"Payment Plan", DISPUTED:"Disputed", SUSPENDED:"Suspended", ACTIVE:"Active" };
const collLabels: Record<string, string> = { NO_CONTACT:"No Contact", LEFT_VOICEMAIL:"Left Voicemail", SPOKE:"Spoke to Customer", PAYMENT_PROMISED:"Payment Promised", PAYMENT_PLAN:"Payment Plan", DISPUTED:"Disputed", ESCALATED:"Escalated", LEGAL:"Legal Review" };

const BB: Record<string, {bg:string,c:string}> = {
  CURRENT:{bg:"#E1F5EE",c:"#085041"}, OVERDUE:{bg:"#FAEEDA",c:"#633806"},
  COLLECTIONS:{bg:"#FCEBEB",c:"#791F1F"}, PAID:{bg:"#F1EFE8",c:"#444441"},
  PAYMENT_PLAN:{bg:"#E6F1FB",c:"#0C447C"}, DISPUTED:{bg:"#FBEAF0",c:"#72243E"},
  SUSPENDED:{bg:"#F1EFE8",c:"#444441"}, ACTIVE:{bg:"#E1F5EE",c:"#085041"},
  NO_CONTACT:{bg:"#F1EFE8",c:"#444441"}, LEFT_VOICEMAIL:{bg:"#FAEEDA",c:"#633806"},
  SPOKE:{bg:"#E6F1FB",c:"#0C447C"}, PAYMENT_PROMISED:{bg:"#E1F5EE",c:"#085041"},
  ESCALATED:{bg:"#FCEBEB",c:"#791F1F"}, LEGAL:{bg:"#FCEBEB",c:"#791F1F"},
};

const Badge = ({status, label:lbl, small}: {status:string, label?:string, small?:boolean}) => {
  const s = BB[status] || {bg:"#eee",c:"#333"};
  const text = lbl || statusLabels[status] || collLabels[status] || status;
  return <span style={{display:"inline-block",fontSize:small?11:12,fontWeight:500,padding:small?"2px 7px":"3px 9px",borderRadius:99,background:s.bg,color:s.c,whiteSpace:"nowrap"}}>{text}</span>;
};

const MC = ({label,value,sub,color}: {label:string,value:string|number,sub?:string,color?:string}) => (
  <div style={{background:"#fff",borderRadius:8,padding:"14px 16px",border:"1px solid #E8E7E3"}}>
    <div style={{fontSize:12,color:"#888780",marginBottom:4}}>{label}</div>
    <div style={{fontSize:22,fontWeight:700,color:color||"#2C2C2A"}}>{value}</div>
    {sub && <div style={{fontSize:11,color:"#B4B2A9",marginTop:2}}>{sub}</div>}
  </div>
);

const Card = ({title,action,children,noPad}: {title?:string,action?:React.ReactNode,children:React.ReactNode,noPad?:boolean}) => (
  <div style={{background:"#fff",border:"1px solid #E8E7E3",borderRadius:12,padding:noPad?0:"1rem 1.25rem",marginBottom:"1rem",overflow:"hidden"}}>
    {title && <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:noPad?0:"1rem",padding:noPad?"1rem 1.25rem 0.75rem":0,borderBottom:noPad?"1px solid #E8E7E3":"none"}}>
      <span style={{fontSize:14,fontWeight:600}}>{title}</span>{action}
    </div>}
    {children}
  </div>
);

const Th = ({children,right}: {children:React.ReactNode,right?:boolean}) => (
  <th style={{textAlign:right?"right":"left",fontSize:11,fontWeight:600,color:"#888780",textTransform:"uppercase",letterSpacing:"0.04em",padding:"8px 12px",borderBottom:"1px solid #E8E7E3",whiteSpace:"nowrap",background:"#FAFAF8"}}>{children}</th>
);
const Td = ({children,right,bold,color,style:s}: {children?:React.ReactNode,right?:boolean,bold?:boolean,color?:string,style?:React.CSSProperties}) => (
  <td style={{padding:"10px 12px",borderBottom:"1px solid #F0EEE8",textAlign:right?"right":"left",fontWeight:bold?600:400,fontSize:13,verticalAlign:"middle",color:color||"inherit",...s}}>{children}</td>
);
const Btn = ({children,onClick,primary,small,danger,disabled}: {children:React.ReactNode,onClick?:()=>void,primary?:boolean,small?:boolean,danger?:boolean,disabled?:boolean}) => (
  <button onClick={onClick} disabled={disabled} style={{background:primary?"#2C2C2A":danger?"#FCEBEB":"#fff",color:primary?"#fff":danger?"#791F1F":"#2C2C2A",border:primary?"none":danger?"1px solid #F09595":"1px solid #D3D1C7",padding:small?"4px 10px":"7px 14px",borderRadius:8,cursor:disabled?"not-allowed":"pointer",fontSize:small?12:13,opacity:disabled?0.5:1,fontWeight:500,display:"inline-flex",alignItems:"center",gap:5}}>{children}</button>
);
const ER = ({cols,msg}: {cols:number,msg:string}) => (
  <tr><td colSpan={cols} style={{textAlign:"center",padding:"2rem",fontSize:13,color:"#888780"}}>{msg}</td></tr>
);
const Modal = ({title,onClose,children,wide}: {title:string,onClose:()=>void,children:React.ReactNode,wide?:boolean}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:"#fff",borderRadius:12,border:"1px solid #D3D1C7",width:"100%",maxWidth:wide?700:520,maxHeight:"90vh",overflow:"auto",boxShadow:"0 20px 60px rgba(0,0,0,0.15)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"1rem 1.25rem",borderBottom:"1px solid #E8E7E3",position:"sticky",top:0,background:"#fff",zIndex:1}}>
        <span style={{fontSize:15,fontWeight:600}}>{title}</span>
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
      ? <select value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} style={{fontSize:13,padding:"7px 10px",border:"1px solid #B4B2A9",borderRadius:8,background:"#fff"}}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>
      : <input type={type||"text"} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} style={{fontSize:13,padding:"7px 10px",border:"1px solid #B4B2A9",borderRadius:8}} />
    }
  </div>
);

export default function ARApp() {
  const [page, setPage] = useState("dashboard");
  const [modal, setModal] = useState<any>(null);
  const [toast, setToast] = useState<{msg:string,type:string}|null>(null);
  const [customers, setCustomersState] = useState<any[]>([]);
  const [invoices, setInvoicesState] = useState<any[]>([]);
  const [payments, setPaymentsState] = useState<any[]>([]);
  const [notes, setNotesState] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const showToast = useCallback((msg:string, type="success") => {
    setToast({msg,type}); setTimeout(()=>setToast(null),3000);
  },[]);

  async function loadAll() {
    setLoading(true);
    try {
      const [c,i,p,n] = await Promise.all([
        fetch("/api/customers").then(r=>r.json()),
        fetch("/api/invoices").then(r=>r.json()),
        fetch("/api/payments?days=365").then(r=>r.json()),
        fetch("/api/notes").then(r=>r.json()),
      ]);
      setCustomersState(Array.isArray(c)?c:[]);
      setInvoicesState(Array.isArray(i)?i:[]);
      setPaymentsState(Array.isArray(p)?p:[]);
      setNotesState(Array.isArray(n)?n:[]);
    } catch(e) { showToast("Failed to load data","error"); }
    setLoading(false);
  }

  useEffect(()=>{ loadAll(); },[]);

  const custMap = useMemo(()=>Object.fromEntries(customers.map((c:any)=>[c.id,c])),[customers]);
  const enriched = useMemo(()=>invoices.map((inv:any)=>({
    ...inv,
    customer: custMap[inv.customerId],
    balance: Number(inv.amount)-Number(inv.paid),
    daysOverdue: Math.max(0, daysDiff(inv.due)),
    daysOld: daysDiff(inv.date),
  })),[invoices,custMap]);
  const open = useMemo(()=>enriched.filter((i:any)=>i.status!=="PAID"),[enriched]);
  const totalAR = open.reduce((s:number,i:any)=>s+i.balance,0);
  const totalOverdue = open.filter((i:any)=>["OVERDUE","COLLECTIONS"].includes(i.status)).reduce((s:number,i:any)=>s+i.balance,0);
  const collected30 = payments.filter((p:any)=>daysDiff(p.date)<=30).reduce((s:number,p:any)=>s+Number(p.amount),0);
  const collRate = (totalAR+collected30)>0?collected30/(totalAR+collected30):0;
  const brokenPromises = notes.filter((n:any)=>n.status==="PAYMENT_PROMISED"&&n.promisedDate&&daysDiff(n.promisedDate)>0);

  const agingTotals = useMemo(()=>{
    const t:{[k:string]:number}={current:0,"1-30":0,"31-60":0,"61-90":0,"90+":0};
    open.forEach((i:any)=>{
      const d=i.daysOverdue;
      const b=d<=0?"current":d<=30?"1-30":d<=60?"31-60":d<=90?"61-90":"90+";
      t[b]+=i.balance;
    });
    return t;
  },[open]);

  const PAGES = [
    {id:"dashboard",label:"Dashboard"},{id:"customers",label:"Customers"},
    {id:"invoices",label:"Invoices"},{id:"payments",label:"Payments"},
    {id:"aging",label:"Aging"},{id:"collections",label:"Collections"},
  ];

  if(loading) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,fontSize:13,color:"#888780"}}>Loading AR data…</div>;

  const shared = {customers,invoices,payments,notes,custMap,enriched,open,setModal,showToast,loadAll};

  return (
    <div>
      {toast && <div style={{position:"fixed",top:16,right:16,zIndex:2000,background:toast.type==="error"?"#FCEBEB":"#E1F5EE",color:toast.type==="error"?"#791F1F":"#085041",border:`1px solid ${toast.type==="error"?"#F09595":"#5DCAA5"}`,borderRadius:8,padding:"10px 16px",fontSize:13,fontWeight:500,boxShadow:"0 4px 16px rgba(0,0,0,0.1)"}}>{toast.msg}</div>}

      <div style={{display:"flex",gap:2,borderBottom:"1px solid #E8E7E3",marginBottom:"1.5rem",overflowX:"auto",background:"#fff"}}>
        {PAGES.map(p=>(
          <button key={p.id} onClick={()=>setPage(p.id)} style={{background:"none",border:"none",borderBottom:page===p.id?"2px solid #2C2C2A":"2px solid transparent",padding:"10px 14px",cursor:"pointer",fontSize:13,fontWeight:page===p.id?600:400,color:page===p.id?"#2C2C2A":"#888780",whiteSpace:"nowrap",marginBottom:"-1px",display:"flex",alignItems:"center",gap:5}}>
            {p.label}
            {p.id==="collections"&&brokenPromises.length>0&&<span style={{background:"#E24B4A",color:"#fff",fontSize:10,fontWeight:700,padding:"1px 5px",borderRadius:99}}>{brokenPromises.length}</span>}
          </button>
        ))}
        <div style={{flex:1}}/>
        <button onClick={()=>setModal("newInvoice")} style={{background:"#2C2C2A",color:"#fff",border:"none",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500,margin:"6px 8px"}}>+ New invoice</button>
        <button onClick={async()=>{setSyncing(true);try{const r=await fetch("/api/sync/fieldroutes",{method:"POST"});const d=await r.json();showToast(`Sync complete: ${d.customersCreated} customers, ${d.invoicesCreated} invoices`);loadAll();}catch{showToast("Sync failed","error");}setSyncing(false);}} style={{background:"#185FA5",color:"#fff",border:"none",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500,margin:"6px 8px 6px 0"}}>{syncing?"Syncing…":"↻ Sync FR"}</button>
      </div>

      {page==="dashboard" && <DashPage {...shared} totalAR={totalAR} totalOverdue={totalOverdue} collected30={collected30} collRate={collRate} agingTotals={agingTotals} brokenPromises={brokenPromises} />}
      {page==="customers" && <CustPage {...shared} />}
      {page==="invoices" && <InvPage {...shared} />}
      {page==="payments" && <PayPage {...shared} />}
      {page==="aging" && <AgePage {...shared} agingTotals={agingTotals} />}
      {page==="collections" && <CollPage {...shared} brokenPromises={brokenPromises} />}

      {modal==="newInvoice" && <InvModal {...shared} invoice={null} onClose={()=>setModal(null)} />}
      {modal?.type==="editInvoice" && <InvModal {...shared} invoice={modal.invoice} onClose={()=>setModal(null)} />}
      {modal==="newCustomer" && <CustModal {...shared} customer={null} onClose={()=>setModal(null)} />}
      {modal==="importCustomers" && <ImportCustModal {...shared} onClose={()=>setModal(null)} />}
      {modal?.type==="editCustomer" && <CustModal {...shared} customer={modal.customer} onClose={()=>setModal(null)} />}
      {modal?.type==="customerDetail" && <CustDetail {...shared} customer={modal.customer} onClose={()=>setModal(null)} />}
      {modal==="newPayment" && <PayModal {...shared} invoice={null} onClose={()=>setModal(null)} />}
      {modal?.type==="recordPayment" && <PayModal {...shared} invoice={modal.invoice} onClose={()=>setModal(null)} />}
      {modal?.type==="addNote" && <NoteModal {...shared} item={modal.item} onClose={()=>setModal(null)} />}
    </div>
  );
}
function DashPage({open,totalAR,totalOverdue,collected30,collRate,agingTotals,payments,custMap,brokenPromises,invoices}: any) {
  const arVB = AR_BENCHMARK>0?totalAR/AR_BENCHMARK:0;
  const topOD = [...open].filter((i:any)=>i.balance>0&&i.daysOverdue>0).sort((a:any,b:any)=>b.balance-a.balance).slice(0,5);
  const recentP = [...payments].sort((a:any,b:any)=>a.date>b.date?-1:1).slice(0,5);
  return (
    <div>
      {brokenPromises.length>0 && <div style={{marginBottom:"1rem"}}>
        {brokenPromises.map((n:any,i:number)=>(
          <div key={i} style={{background:"#FCEBEB",border:"1px solid #F09595",borderRadius:8,padding:"9px 14px",fontSize:12,color:"#A32D2D",fontWeight:500,marginBottom:6}}>
            ⚠ Broken promise: {custMap[n.customerId]?.name} owed {fmt(n.promisedAmount)} by {n.promisedDate?.split("T")[0]}
          </div>
        ))}
      </div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10,marginBottom:"1.5rem"}}>
        <MC label="Total AR" value={fmt(totalAR)} sub={open.length+" open invoices"} />
        <MC label="AR benchmark" value={fmt(AR_BENCHMARK)} />
        <MC label="AR vs benchmark" value={pct(arVB)} color={arVB>1?"#E24B4A":"#0F6E56"} sub={arVB>1?"Over ▲":"Under ✓"} />
        <MC label="Total past due" value={fmt(totalOverdue)} color="#E24B4A" />
        <MC label="Collected (30d)" value={fmt(collected30)} color="#0F6E56" sub={pct(collRate)+" rate"} />
        <MC label="Open invoices" value={open.length} />
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1rem"}}>
        <Card title="Top overdue" noPad>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><Th>Customer</Th><Th>Invoice</Th><Th right>Days</Th><Th right>Balance</Th></tr></thead>
            <tbody>
              {topOD.length===0?<ER cols={4} msg="No overdue invoices"/>:topOD.map((inv:any)=>(
                <tr key={inv.id}><Td bold>{inv.customer?.name||"—"}</Td><Td>{inv.id}</Td><Td right color="#E24B4A">{inv.daysOverdue}d</Td><Td right bold>{fmt(inv.balance)}</Td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Recent payments" noPad>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr><Th>Customer</Th><Th>Date</Th><Th>Method</Th><Th right>Amount</Th></tr></thead>
            <tbody>
              {recentP.length===0?<ER cols={4} msg="No payments yet"/>:recentP.map((p:any)=>{
                const inv=invoices?.find((i:any)=>i.id===p.invoiceId);
                const c=inv?custMap[inv.customerId]:null;
                return <tr key={p.id}><Td>{c?.name||"—"}</Td><Td>{p.date?.split("T")[0]}</Td><Td><span style={{fontSize:12,fontWeight:500,color:"#0C447C"}}>{p.method}</span></Td><Td right bold color="#0F6E56">{fmt(Number(p.amount))}</Td></tr>;
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function CustPage({customers,enriched,custMap,setModal,showToast,loadAll}: any) {
  const [search,setSearch]=useState("");
  const [statusF,setStatusF]=useState("");
  const balBC=useMemo(()=>{const m:any={};enriched.forEach((i:any)=>{if(i.status!=="PAID")m[i.customerId]=(m[i.customerId]||0)+i.balance});return m},[enriched]);
  const filtered=customers.filter((c:any)=>{
    if(statusF&&c.status!==statusF)return false;
    if(search&&!c.name?.toLowerCase().includes(search.toLowerCase())&&!c.email?.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });
  const del=async(id:string)=>{if(!confirm("Delete this customer?"))return;await fetch(`/api/customers/${id}`,{method:"DELETE"});showToast("Customer deleted");loadAll();};
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:"1rem",alignItems:"center",flexWrap:"wrap"}}>
        <input placeholder="Search name or email…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:160,fontSize:13,padding:"7px 10px",border:"1px solid #B4B2A9",borderRadius:8}}/>
        <select value={statusF} onChange={e=>setStatusF(e.target.value)} style={{fontSize:13,padding:"7px 10px",border:"1px solid #B4B2A9",borderRadius:8}}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="COLLECTIONS">Collections</option><option value="SUSPENDED">Suspended</option>
        </select>
        <Btn onClick={()=>setModal("importCustomers")}>↑ Import CSV</Btn>
        <Btn primary onClick={()=>setModal("newCustomer")}>+ Add customer</Btn>
      </div>
      <Card noPad>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><Th>Customer</Th><Th>Contact</Th><Th>FR ID</Th><Th>Rep</Th><Th>Terms</Th><Th>Status</Th><Th right>Open AR</Th><Th>&nbsp;</Th></tr></thead>
          <tbody>
            {filtered.map((c:any)=>(
              <tr key={c.id} style={{cursor:"pointer"}} onClick={()=>setModal({type:"customerDetail",customer:c})}>
                <Td bold><div>{c.name}</div><div style={{fontSize:11,color:"#888780"}}>{c.email}</div></Td>
                <Td><div>{c.contact}</div><div style={{fontSize:11,color:"#888780"}}>{c.phone}</div></Td>
                <Td style={{fontSize:11,color:"#888780"}}>{c.externalId||"—"}</Td><Td>{c.rep}</Td><Td>{c.terms}</Td>
                <Td><Badge status={c.status} small/></Td>
                <Td right bold color={balBC[c.id]>0?"#2C2C2A":"#B4B2A9"}>{balBC[c.id]?fmt(balBC[c.id]):"—"}</Td>
                <Td><div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                  <Btn small onClick={()=>setModal({type:"editCustomer",customer:c})}>✎</Btn>
                  <Btn small danger onClick={()=>del(c.id)}>✕</Btn>
                </div></Td>
              </tr>
            ))}
            {filtered.length===0&&<ER cols={7} msg="No customers match"/>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function InvPage({enriched,invoices,custMap,setModal,showToast,loadAll}: any) {
  const [search,setSearch]=useState("");
  const [statusF,setStatusF]=useState("");
  const filtered=enriched.filter((i:any)=>{
    if(statusF&&i.status!==statusF)return false;
    if(search){const s=search.toLowerCase();if(!i.id?.toLowerCase().includes(s)&&!i.customer?.name?.toLowerCase().includes(s))return false;}
    return true;
  });
  const del=async(id:string)=>{if(!confirm("Delete invoice "+id+"?"))return;await fetch(`/api/invoices/${id}`,{method:"DELETE"});showToast("Invoice deleted");loadAll();};
  const csvExport=()=>{
    const rows=[["Invoice#","Customer","Date","Due","Amount","Balance","Status"],...filtered.map((i:any)=>[i.id,i.customer?.name,i.date?.split("T")[0],i.due?.split("T")[0],i.amount,i.balance,i.status])];
    const a=document.createElement("a");a.href="data:text/csv,"+encodeURIComponent(rows.map(r=>r.join(",")).join("\n"));a.download="invoices.csv";a.click();
  };
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap",alignItems:"center"}}>
        <input placeholder="Search invoice # or customer…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:160,fontSize:13,padding:"7px 10px",border:"1px solid #B4B2A9",borderRadius:8}}/>
        <select value={statusF} onChange={e=>setStatusF(e.target.value)} style={{fontSize:13,padding:"7px 10px",border:"1px solid #B4B2A9",borderRadius:8}}>
          <option value="">All statuses</option>
          {["CURRENT","OVERDUE","COLLECTIONS","PAYMENT_PLAN","PAID","DISPUTED"].map(s=><option key={s} value={s}>{statusLabels[s]}</option>)}
        </select>
        <Btn onClick={csvExport}>↓ Export</Btn>
        <Btn primary onClick={()=>setModal("newInvoice")}>+ New</Btn>
      </div>
      <Card noPad>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><Th>Invoice #</Th><Th>Customer</Th><Th>Due</Th><Th right>Amount</Th><Th right>Balance</Th><Th>Status</Th><Th>&nbsp;</Th></tr></thead>
          <tbody>
            {filtered.map((inv:any)=>(
              <tr key={inv.id}>
                <Td bold>{inv.id}</Td>
                <Td>{inv.customer?.name||"—"}</Td>
                <Td color={inv.daysOverdue>0?"#E24B4A":"inherit"}>{inv.due?.split("T")[0]}</Td>
                <Td right>{fmt(Number(inv.amount))}</Td>
                <Td right bold>{fmt(inv.balance)}</Td>
                <Td><Badge status={inv.status} small/></Td>
                <Td><div style={{display:"flex",gap:4}}>
                  {inv.balance>0&&<Btn small onClick={()=>setModal({type:"recordPayment",invoice:inv})}>Pay</Btn>}
                  {inv.balance>0&&<Btn small onClick={()=>setModal({type:"addNote",item:inv})}>Note</Btn>}
                  <Btn small onClick={()=>setModal({type:"editInvoice",invoice:inv})}>✎</Btn>
                  <Btn small danger onClick={()=>del(inv.id)}>✕</Btn>
                </div></Td>
              </tr>
            ))}
            {filtered.length===0&&<ER cols={7} msg="No invoices match"/>}
          </tbody>
          {filtered.length>0&&<tfoot><tr style={{background:"#FAFAF8"}}>
            <td colSpan={3} style={{padding:"9px 12px",fontSize:13,fontWeight:600}}>Total ({filtered.length})</td>
            <td style={{padding:"9px 12px",textAlign:"right",fontSize:13,fontWeight:600}}>{fmt(filtered.reduce((s:number,i:any)=>s+Number(i.amount),0))}</td>
            <td style={{padding:"9px 12px",textAlign:"right",fontSize:13,fontWeight:600}}>{fmt(filtered.reduce((s:number,i:any)=>s+i.balance,0))}</td>
            <td colSpan={2}/>
          </tr></tfoot>}
        </table>
      </Card>
    </div>
  );
}

function PayPage({payments,invoices,custMap,showToast,loadAll,setModal}: any) {
  const ep=payments.map((p:any)=>{const inv=invoices.find((i:any)=>i.id===p.invoiceId);return{...p,customer:inv?custMap[inv.customerId]:null}}).sort((a:any,b:any)=>a.date>b.date?-1:1);
  const t30=payments.filter((p:any)=>daysDiff(p.date)<=30).reduce((s:number,p:any)=>s+Number(p.amount),0);
  const del=async(id:string)=>{if(!confirm("Delete this payment?"))return;await fetch(`/api/payments/${id}`,{method:"DELETE"});showToast("Payment deleted");loadAll();};
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginBottom:"1.5rem"}}>
        <MC label="Collected (30d)" value={fmt(t30)} color="#0F6E56"/>
        <MC label="Total payments" value={payments.length}/>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:"1rem"}}>
        <Btn onClick={()=>setModal("importCustomers")}>↑ Import CSV</Btn>
        <Btn primary onClick={()=>setModal("newCustomer")}>+ Add customer</Btn>
      </div>
      <Card noPad>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><Th>Ref #</Th><Th>Customer</Th><Th>Invoice</Th><Th>Date</Th><Th>Method</Th><Th right>Amount</Th><Th>Note</Th><Th>&nbsp;</Th></tr></thead>
          <tbody>
            {ep.map((p:any)=>(
              <tr key={p.id}>
                <Td bold>{p.reference}</Td><Td>{p.customer?.name||"—"}</Td><Td>{p.invoiceId}</Td>
                <Td>{p.date?.split("T")[0]}</Td>
                <Td><span style={{fontSize:12,fontWeight:500,color:"#0C447C"}}>{p.method}</span></Td>
                <Td right bold color="#0F6E56">{fmt(Number(p.amount))}</Td>
                <Td style={{fontSize:12,color:"#888780",maxWidth:160}}>{p.note}</Td>
                <Td><Btn small danger onClick={()=>del(p.id)}>✕</Btn></Td>
              </tr>
            ))}
            {ep.length===0&&<ER cols={8} msg="No payments yet"/>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function AgePage({open,agingTotals,custMap}: any) {
  const buckets=["current","1-30","31-60","61-90","90+"];
  const bC:any={current:"#1D9E75","1-30":"#EF9F27","31-60":"#D87020","61-90":"#E24B4A","90+":"#A32D2D"};
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
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:"1.5rem"}}>
        {buckets.map(b=><MC key={b} label={b==="current"?"Current":b+" days"} value={fmt((agingTotals as any)[b])} color={bC[b]} sub={pct((agingTotals as any)[b]/Number(total))}/>)}
        <MC label="Total AR" value={fmt(Number(total))}/>
      </div>
      <Card title="Aging by customer" noPad>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><Th>Customer</Th>{buckets.map(b=><Th key={b} right>{b==="current"?"Current":b}</Th>)}<Th right>Total</Th></tr></thead>
          <tbody>
            {byCust.map((r:any)=>(
              <tr key={r.customer?.id}>
                <Td bold>{r.customer?.name||"—"}</Td>
                {buckets.map(b=><Td key={b} right color={r[b]>0?bC[b]:"#B4B2A9"} style={{fontWeight:r[b]>0?600:400}}>{r[b]>0?fmt(r[b]):"—"}</Td>)}
                <Td right bold>{fmt(r.total)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{background:"#FAFAF8"}}>
            <td style={{padding:"9px 12px",fontWeight:600,fontSize:13}}>Total</td>
            {buckets.map(b=><td key={b} style={{padding:"9px 12px",textAlign:"right",fontWeight:600,fontSize:13}}>{fmt((agingTotals as any)[b])}</td>)}
            <td style={{padding:"9px 12px",textAlign:"right",fontWeight:600,fontSize:13}}>{fmt(Number(total))}</td>
          </tr></tfoot>
        </table>
      </Card>
    </div>
  );
}

function CollPage({open,notes,custMap,setModal,showToast,loadAll,brokenPromises}: any) {
  const queue=[...open].filter((i:any)=>i.balance>0&&i.daysOverdue>=1).sort((a:any,b:any)=>b.balance-a.balance);
  const lastNote=(id:string)=>[...notes].filter((n:any)=>n.invoiceId===id).sort((a:any,b:any)=>a.date>b.date?-1:1)[0];
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:"1.5rem"}}>
        <MC label="In queue" value={queue.length} sub="Need follow-up"/>
        <MC label="Promised" value={notes.filter((n:any)=>n.status==="PAYMENT_PROMISED").length} color="#0F6E56"/>
        <MC label="Broken promises" value={brokenPromises.length} color={brokenPromises.length>0?"#E24B4A":"#888780"}/>
        <MC label="Disputed" value={notes.filter((n:any)=>n.status==="DISPUTED").length} color="#E24B4A"/>
      </div>
      <Card title="Collections queue" noPad action={<Btn small onClick={()=>setModal({type:"addNote",item:null})}>+ Log note</Btn>}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><Th>Customer</Th><Th>Invoice</Th><Th>Days overdue</Th><Th right>Balance</Th><Th>Last contact</Th><Th>Status</Th><Th>&nbsp;</Th></tr></thead>
          <tbody>
            {queue.map((inv:any)=>{
              const note=lastNote(inv.id);
              return <tr key={inv.id}>
                <Td bold>{inv.customer?.name||"—"}</Td><Td>{inv.id}</Td>
                <Td><span style={{color:inv.daysOverdue>60?"#E24B4A":"#BA7517",fontWeight:600}}>{inv.daysOverdue}d</span></Td>
                <Td right bold>{fmt(inv.balance)}</Td>
                <Td style={{fontSize:12,color:"#888780",maxWidth:180}}>{note?<span><strong>{note.date?.split("T")[0]}</strong> · {note.text?.substring(0,40)}</span>:<span style={{color:"#B4B2A9"}}>No contact yet</span>}</Td>
                <Td>{note?<Badge status={note.status} small/>:<Badge status="NO_CONTACT" small/>}</Td>
                <Td><Btn small onClick={()=>setModal({type:"addNote",item:inv})}>Note</Btn></Td>
              </tr>;
            })}
            {queue.length===0&&<ER cols={7} msg="No overdue invoices"/>}
          </tbody>
        </table>
      </Card>
      <Card title="Collection notes" noPad>
        {notes.length===0?<div style={{padding:"1.5rem",textAlign:"center",fontSize:13,color:"#888780"}}>No notes yet.</div>:
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr><Th>Date</Th><Th>Customer</Th><Th>Invoice</Th><Th>Status</Th><Th>Note</Th></tr></thead>
          <tbody>{[...notes].sort((a:any,b:any)=>a.date>b.date?-1:1).map((n:any)=>(
            <tr key={n.id}><Td>{n.date?.split("T")[0]}</Td><Td bold>{custMap[n.customerId]?.name||"—"}</Td><Td>{n.invoiceId}</Td><Td><Badge status={n.status} small/></Td><Td style={{fontSize:12,maxWidth:200}}>{n.text}</Td></tr>
          ))}</tbody>
        </table>}
      </Card>
    </div>
  );
}

function InvModal({customers,invoice,onClose,showToast,loadAll}: any) {
  const isEdit=!!invoice;
  const ts=new Date().toISOString().split("T")[0];
  const due=new Date();due.setDate(due.getDate()+30);
  const [f,setF]=useState({customerId:invoice?.customerId||"",id:invoice?.id||"INV-"+Math.floor(1000+Math.random()*8000),date:invoice?.date?.split("T")[0]||ts,due:invoice?.due?.split("T")[0]||due.toISOString().split("T")[0],amount:String(invoice?.amount||""),description:invoice?.description||"",serviceType:invoice?.serviceType||"Pest Control",status:invoice?.status||"CURRENT"});
  const set=(k:string,v:string)=>setF(p=>({...p,[k]:v}));
  const submit=async()=>{
    if(!f.customerId||!f.amount)return showToast("Fill required fields","error");
    const method=isEdit?"PUT":"POST";
    const url=isEdit?`/api/invoices/${invoice.id}`:"/api/invoices";
    await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify({...f,amount:parseFloat(f.amount),paid:invoice?.paid||0})});
    showToast(isEdit?"Invoice updated":"Invoice created");loadAll();onClose();
  };
  return (
    <Modal title={isEdit?"Edit invoice":"Create invoice"} onClose={onClose}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Inp label="Customer *" value={f.customerId} onChange={v=>set("customerId",v)} options={[{value:"",label:"Select customer…"},...customers.map((c:any)=>({value:c.id,label:c.name}))]}/>
        <Inp label="Invoice # *" value={f.id} onChange={v=>set("id",v)} disabled={isEdit}/>
        <Inp label="Issue date" value={f.date} onChange={v=>set("date",v)} type="date"/>
        <Inp label="Due date" value={f.due} onChange={v=>set("due",v)} type="date"/>
        <Inp label="Amount ($) *" value={f.amount} onChange={v=>set("amount",v)} type="number" placeholder="5000"/>
        <Inp label="Status" value={f.status} onChange={v=>set("status",v)} options={["CURRENT","OVERDUE","COLLECTIONS","PAYMENT_PLAN","DISPUTED","PAID"].map(s=>({value:s,label:statusLabels[s]}))}/>
        <Inp label="Service type" value={f.serviceType} onChange={v=>set("serviceType",v)} options={["Pest Control","Lawn Care","HVAC","Plumbing","Consulting","Other"].map(s=>({value:s,label:s}))} />
        <Inp label="Description" value={f.description} onChange={v=>set("description",v)} placeholder="Services…" style={{gridColumn:"span 2"}}/>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={submit}>{isEdit?"Save changes":"Create invoice"}</Btn>
      </div>
    </Modal>
  );
}

function CustModal({customer,onClose,showToast,loadAll}: any) {
  const isEdit=!!customer;
  const [f,setF]=useState({name:customer?.name||"",email:customer?.email||"",phone:customer?.phone||"",contact:customer?.contact||"",billingAddr:customer?.billingAddr||"",status:customer?.status||"ACTIVE",rep:customer?.rep||"",terms:customer?.terms||"Net 30",notes:customer?.notes||""});
  const set=(k:string,v:string)=>setF(p=>({...p,[k]:v}));
  const submit=async()=>{
    if(!f.name)return showToast("Name required","error");
    const method=isEdit?"PATCH":"POST";
    const url=isEdit?`/api/customers/${customer.id}`:"/api/customers";
    await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(f)});
    showToast(isEdit?"Customer updated":"Customer added");loadAll();onClose();
  };
  return (
    <Modal title={isEdit?"Edit customer":"Add customer"} onClose={onClose} wide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Inp label="Name *" value={f.name} onChange={v=>set("name",v)} placeholder="Acme Corp"/>
        <Inp label="Contact person" value={f.contact} onChange={v=>set("contact",v)}/>
        <Inp label="Email" value={f.email} onChange={v=>set("email",v)} type="email"/>
        <Inp label="Phone" value={f.phone} onChange={v=>set("phone",v)}/>
        <Inp label="Billing address" value={f.billingAddr} onChange={v=>set("billingAddr",v)} style={{gridColumn:"span 2"}}/>
        <Inp label="Status" value={f.status} onChange={v=>set("status",v)} options={["ACTIVE","SUSPENDED","COLLECTIONS"].map(s=>({value:s,label:s[0]+s.slice(1).toLowerCase()}))}/>
        <Inp label="Terms" value={f.terms} onChange={v=>set("terms",v)} options={["Net 15","Net 30","Net 45","Net 60","Due on receipt"].map(s=>({value:s,label:s}))}/>
        <Inp label="Assigned rep" value={f.rep} onChange={v=>set("rep",v)} placeholder="Rep name"/>
        <Inp label="Notes" value={f.notes} onChange={v=>set("notes",v)} style={{gridColumn:"span 2"}}/>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={submit}>{isEdit?"Save changes":"Add customer"}</Btn>
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
        <div style={{fontWeight:600}}>{custMap[invoice.customerId]?.name} · {invoice.id}</div>
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

function NoteModal({item,customers,onClose,showToast,loadAll}: any) {
  const ts=new Date().toISOString().split("T")[0];
  const [f,setF]=useState({customerId:item?.customerId||"",invoiceId:item?.id||"",date:ts,text:"",status:"SPOKE",followUpDate:"",rep:"",promisedDate:"",promisedAmount:""});
  const set=(k:string,v:string)=>setF(p=>({...p,[k]:v}));
  const submit=async()=>{
    if(!f.customerId||!f.text)return showToast("Fill required fields","error");
    await fetch("/api/notes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...f,promisedAmount:parseFloat(f.promisedAmount)||0})});
    showToast("Note logged");loadAll();onClose();
  };
  return (
    <Modal title={item?"Log note — "+item.id:"Log collection note"} onClose={onClose}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {!item&&<Inp label="Customer *" value={f.customerId} onChange={v=>set("customerId",v)} options={[{value:"",label:"Select…"},...customers.map((c:any)=>({value:c.id,label:c.name}))]}/>}
        {!item&&<Inp label="Invoice ID" value={f.invoiceId} onChange={v=>set("invoiceId",v)} placeholder="INV-…"/>}
        <Inp label="Date" value={f.date} onChange={v=>set("date",v)} type="date"/>
        <Inp label="Rep" value={f.rep} onChange={v=>set("rep",v)} placeholder="Your name"/>
        <Inp label="Status" value={f.status} onChange={v=>set("status",v)} options={Object.entries(collLabels).map(([k,v])=>({value:k,label:v}))} style={{gridColumn:"span 2"}}/>
        <Inp label="Note *" value={f.text} onChange={v=>set("text",v)} placeholder="What happened?" style={{gridColumn:"span 2"}}/>
        <Inp label="Follow-up date" value={f.followUpDate} onChange={v=>set("followUpDate",v)} type="date"/>
        {f.status==="PAYMENT_PROMISED"&&<Inp label="Promised date" value={f.promisedDate} onChange={v=>set("promisedDate",v)} type="date"/>}
        {f.status==="PAYMENT_PROMISED"&&<Inp label="Promised amount ($)" value={f.promisedAmount} onChange={v=>set("promisedAmount",v)} type="number"/>}
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={submit}>Save note</Btn>
      </div>
    </Modal>
  );
}

function CustDetail({customer:c,enriched,notes,custMap,setModal,onClose}: any) {
  const invs=enriched.filter((i:any)=>i.customerId===c.id);
  const cn=[...notes].filter((n:any)=>n.customerId===c.id).sort((a:any,b:any)=>a.date>b.date?-1:1);
  const bal=invs.filter((i:any)=>i.status!=="PAID").reduce((s:number,i:any)=>s+i.balance,0);
  return (
    <Modal title={c.name} onClose={onClose} wide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16,background:"#F7F6F2",borderRadius:8,padding:"12px 14px"}}>
        <div><div style={{fontSize:11,color:"#888780"}}>Contact</div><div style={{fontWeight:600,fontSize:13}}>{c.contact||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Status</div><Badge status={c.status} small/></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Email</div><div style={{fontSize:13}}>{c.email||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Phone</div><div style={{fontSize:13}}>{c.phone||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Terms</div><div style={{fontSize:13}}>{c.terms||"—"}</div></div>
        <div><div style={{fontSize:11,color:"#888780"}}>Open AR</div><div style={{fontSize:16,fontWeight:600,color:bal>0?"#E24B4A":"inherit"}}>{fmt(bal)}</div></div>
        {c.notes&&<div style={{gridColumn:"span 2"}}><div style={{fontSize:11,color:"#888780"}}>Notes</div><div style={{fontSize:13}}>{c.notes}</div></div>}
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <Btn small onClick={()=>setModal({type:"editCustomer",customer:c})}>✎ Edit customer</Btn>
      </div>
      <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>Invoices ({invs.length})</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,marginBottom:16}}>
        <thead><tr><Th>Invoice</Th><Th>Due</Th><Th right>Amount</Th><Th right>Balance</Th><Th>Status</Th></tr></thead>
        <tbody>{invs.map((i:any)=><tr key={i.id}><Td bold>{i.id}</Td><Td>{i.due?.split("T")[0]}</Td><Td right>{fmt(Number(i.amount))}</Td><Td right bold>{fmt(i.balance)}</Td><Td><Badge status={i.status} small/></Td></tr>)}</tbody>
      </table>
      {cn.length>0&&<>
        <div style={{fontWeight:600,fontSize:13,marginBottom:8}}>Notes ({cn.length})</div>
        {cn.map((n:any)=><div key={n.id} style={{padding:"8px 0",borderBottom:"1px solid #F0EEE8",fontSize:13}}>
          <div style={{fontSize:11,color:"#888780",marginBottom:2}}>{n.date?.split("T")[0]} · {n.rep} · <Badge status={n.status} small/></div>
          <div>{n.text}</div>
        </div>)}
      </>}
    </Modal>
  );
}

function ImportCustModal({onClose,showToast,loadAll}: any) {
  const [text,setText]=useState("");
  const [preview,setPreview]=useState<any[]>([]);
  const [importing,setImporting]=useState(false);

  function parse() {
    const lines=text.trim().split("\n");
    if(lines.length<2)return;
    const headers=lines[0].split(",").map((h:string)=>h.trim().toLowerCase().replace(/\s+/g,""));
    const result:any[]=[];
    for(let i=1;i<lines.length;i++){
      const vals=lines[i].split(",").map((v:string)=>v.trim().replace(/^"|"$/g,""));
      const obj:any={};
      headers.forEach((h:string,idx:number)=>{obj[h]=vals[idx]||"";});
      const firstName=obj.firstname||obj.fname||"";
      const lastName=obj.lastname||obj.lname||"";
      const fullName=obj.name||obj.customername||(firstName&&lastName?firstName+" "+lastName:firstName||lastName)||"";
      const frId=obj.customer||obj.customerid||obj.externalid||obj.id||"";
      if(!fullName)continue;
      result.push({
        name: fullName,
        email: obj.email||obj.emailaddress||obj.emailaddr||"",
        phone: obj.phone||obj.phonenumber||obj.phone1||obj.primaryphone||"",
        contact: obj.contact||obj.contactperson||fullName||"",
        billingAddr: obj.address||obj.billingaddress||"",
        status: (obj.status||"ACTIVE").toUpperCase(),
        rep: obj.rep||obj.assignedrep||"",
        terms: obj.terms||"Net 30",
        notes: obj.notes||"",
        externalId: frId,
      });
    }
    setPreview(result);
  }

  async function importAll() {
    setImporting(true);
    try {
      const res=await fetch("/api/customers/import",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customers:preview})});
      const data=await res.json();
      showToast("Imported "+data.created+" customers, skipped "+data.skipped);
      loadAll();
      onClose();
    } catch(e) {
      showToast("Import failed","error");
    }
    setImporting(false);
  }

  return (
    <Modal title="Import customers from CSV" onClose={onClose} wide>
      <div style={{fontSize:12,color:"#888780",marginBottom:8}}>
        <div>CSV headers: name, email, phone, contact, address, status, rep, terms, notes, customerID</div>
        <div>Only name is required. customerID links to FieldRoutes for payment sync.</div>
      </div>
      <textarea value={text} onChange={e=>setText(e.target.value)} placeholder={"name,email,phone,customerID\nJohn Smith,john@example.com,555-1234,12345"} style={{width:"100%",height:130,fontSize:12,fontFamily:"monospace",padding:10,border:"1px solid #D3D1C7",borderRadius:8,resize:"vertical"}}/>
      <div style={{display:"flex",gap:8,margin:"10px 0 14px"}}>
        <Btn onClick={parse}>Preview</Btn>
        <span style={{fontSize:12,color:"#888780",alignSelf:"center"}}>{preview.length>0?preview.length+" customers ready":""}</span>
      </div>
      {preview.length>0 && (
        <div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginBottom:12}}>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>FR ID</Th><Th>Status</Th></tr></thead>
            <tbody>
              {preview.slice(0,10).map((c:any,i:number)=>(
                <tr key={i}><Td>{c.name}</Td><Td>{c.email||"—"}</Td><Td>{c.phone||"—"}</Td><Td>{c.externalId||"—"}</Td><Td><Badge status={c.status} small/></Td></tr>
              ))}
            </tbody>
          </table>
          {preview.length>10 && <p style={{fontSize:12,color:"#888780",marginBottom:12}}>...and {preview.length-10} more</p>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn primary onClick={importAll} disabled={importing}>{importing?"Importing…":"↑ Import "+preview.length+" customers"}</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
      
