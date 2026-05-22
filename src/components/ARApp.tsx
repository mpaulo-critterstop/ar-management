"use client";
import { useState, useEffect } from "react";

interface KPI {
  totalAR: number;
  overdueAR: number;
  collected30: number;
  collectionRate: number;
  arVsBenchmark: number;
  openCount: number;
}

interface Invoice {
  id: string;
  amount: number;
  paid: number;
  due: string;
  status: string;
  customer?: { name: string };
}

interface Customer {
  id: string;
  name: string;
  contact?: string;
  status: string;
}

export default function ARApp(): JSX.Element {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [c, i, k] = await Promise.all([
          fetch("/api/customers").then(r => r.json()),
          fetch("/api/invoices").then(r => r.json()),
          fetch("/api/kpi").then(r => r.json()),
        ]);
        setCustomers(c);
        setInvoices(i);
        setKpi(k);
      } catch (e) {
        console.error(e);
      }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:300, fontSize:13, color:"#888780" }}>
        Loading AR data…
      </div>
    );
  }

  if (!kpi) {
    return (
      <div style={{ padding:"2rem", textAlign:"center", color:"#A32D2D" }}>
        Failed to load data. Check your database connection.
      </div>
    );
  }

  const metrics = [
    { label:"Total AR",        value:"$"+Math.round(kpi.totalAR).toLocaleString() },
    { label:"Past due",        value:"$"+Math.round(kpi.overdueAR).toLocaleString() },
    { label:"Collected (30d)", value:"$"+Math.round(kpi.collected30).toLocaleString() },
    { label:"Collection rate", value:Math.round(kpi.collectionRate*100)+"%" },
    { label:"AR vs benchmark", value:Math.round(kpi.arVsBenchmark*100)+"%" },
    { label:"Open invoices",   value:String(kpi.openCount) },
  ];

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:"1.5rem" }}>
        {metrics.map(m => (
          <div key={m.label} style={{ background:"#fff", borderRadius:8, padding:"14px 16px", border:"1px solid #E8E7E3" }}>
            <div style={{ fontSize:11, color:"#888780", marginBottom:4 }}>{m.label}</div>
            <div style={{ fontSize:22, fontWeight:700 }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"1rem" }}>
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8E7E3", padding:"1rem 1.25rem" }}>
          <div style={{ fontWeight:600, marginBottom:"1rem" }}>Recent invoices</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                {["Invoice","Customer","Due","Balance","Status"].map(h => (
                  <th key={h} style={{ textAlign:"left", fontSize:11, fontWeight:600, color:"#888780", textTransform:"uppercase", letterSpacing:"0.04em", padding:"6px 10px", borderBottom:"1px solid #E8E7E3" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.slice(0,8).map(inv => (
                <tr key={inv.id}>
                  <td style={{ padding:"9px 10px", fontSize:13, fontWeight:600, borderBottom:"1px solid #F5F4F0" }}>{inv.id}</td>
                  <td style={{ padding:"9px 10px", fontSize:13, borderBottom:"1px solid #F5F4F0" }}>{inv.customer?.name||"—"}</td>
                  <td style={{ padding:"9px 10px", fontSize:13, borderBottom:"1px solid #F5F4F0" }}>{inv.due?.split("T")[0]}</td>
                  <td style={{ padding:"9px 10px", fontSize:13, fontWeight:600, borderBottom:"1px solid #F5F4F0" }}>${Math.round(Number(inv.amount)-Number(inv.paid)).toLocaleString()}</td>
                  <td style={{ padding:"9px 10px", fontSize:12, borderBottom:"1px solid #F5F4F0" }}>
                    <span style={{
                      padding:"2px 8px", borderRadius:99, fontSize:11, fontWeight:500,
                      background:inv.status==="PAID"?"#E1F5EE":inv.status==="OVERDUE"?"#FAEEDA":inv.status==="COLLECTIONS"?"#FCEBEB":"#E6F1FB",
                      color:inv.status==="PAID"?"#085041":inv.status==="OVERDUE"?"#633806":inv.status==="COLLECTIONS"?"#791F1F":"#0C447C"
                    }}>
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8E7E3", padding:"1rem 1.25rem" }}>
          <div style={{ fontWeight:600, marginBottom:"1rem" }}>Customers</div>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr>
                {["Name","Contact","Status"].map(h => (
                  <th key={h} style={{ textAlign:"left", fontSize:11, fontWeight:600, color:"#888780", textTransform:"uppercase", letterSpacing:"0.04em", padding:"6px 10px", borderBottom:"1px solid #E8E7E3" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customers.slice(0,8).map(c => (
                <tr key={c.id}>
                  <td style={{ padding:"9px 10px", fontSize:13, fontWeight:600, borderBottom:"1px solid #F5F4F0" }}>{c.name}</td>
                  <td style={{ padding:"9px 10px", fontSize:13, borderBottom:"1px solid #F5F4F0" }}>{c.contact||"—"}</td>
                  <td style={{ padding:"9px 10px", fontSize:12, borderBottom:"1px solid #F5F4F0" }}>
                    <span style={{
                      padding:"2px 8px", borderRadius:99, fontSize:11, fontWeight:500,
                      background:c.status==="ACTIVE"?"#E1F5EE":c.status==="COLLECTIONS"?"#FCEBEB":"#F1EFE8",
                      color:c.status==="ACTIVE"?"#085041":c.status==="COLLECTIONS"?"#791F1F":"#444441"
                    }}>
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
