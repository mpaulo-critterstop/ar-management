'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const ACCENT = '#92c1e9';
const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtD(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number | null | undefined) { 
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toFixed(1) + '%'; 
}

export default function KPIPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [office, setOffice] = useState('All');
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPMManager, setShowPMManager] = useState(false);
  const [pms, setPms] = useState<any[]>([]);
  const [newPMName, setNewPMName] = useState('');
  const [newPMOffice, setNewPMOffice] = useState('DFW');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetchKPIs();
  }, [office, period, status]);

  async function fetchKPIs() {
    setLoading(true);
    const params = new URLSearchParams();
    if (office !== 'All') params.set('office', office);
    params.set('period', period);
    const res = await fetch('/api/kpi/leads?' + params.toString());
    const d = await res.json();
    setData(d);
    setLoading(false);
  }

  async function fetchPMs() {
    const res = await fetch('/api/pm');
    const d = await res.json();
    setPms(d);
  }

  async function addPM() {
    if (!newPMName.trim()) return;
    await fetch('/api/pm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newPMName.trim(), office: newPMOffice }),
    });
    setNewPMName('');
    fetchPMs();
    fetchKPIs();
  }

  async function togglePM(id: string, active: boolean) {
    await fetch('/api/pm', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    });
    fetchPMs();
    fetchKPIs();
  }

  if (status === 'loading') return null;

  const labels = data?.labels || [];
  const company = data?.company || [];
  const pmData = (data?.pms || []).filter((pm: any) => office === 'All' || pm.office.toLowerCase() === office.toLowerCase());

  const companyRows = period === 'monthly' ? [
    { label: 'Total Booked Revenue', fn: (m: any) => fmt(m.booked), bold: true },
    { label: 'Total Leads', fn: (m: any) => m.totalLeads },
    { label: 'Total Closed', fn: (m: any) => m.totalClosed },
    { label: 'Closing %', fn: (m: any) => pct(m.closingPct) },
    { label: 'Avg Closed Sale $', fn: (m: any) => fmt(m.avgSale) },
    { label: 'Booked $ / Lead', fn: (m: any) => fmt(m.bookedPerLead) },
    { label: '% Growth YoY', fn: (m: any) => m.yoyGrowth !== null ? pct(m.yoyGrowth) : '—' },
  ] : [
    { label: 'Total Booked Revenue', fn: (m: any) => fmt(m.booked), bold: true },
    { label: 'Total Leads', fn: (m: any) => m.totalLeads },
    { label: 'Total Closed', fn: (m: any) => m.totalClosed },
    { label: 'Closing %', fn: (m: any) => pct(m.closingPct) },
    { label: 'Avg Closed Sale $', fn: (m: any) => fmt(m.avgSale) },
    { label: 'Booked $ / Lead', fn: (m: any) => fmt(m.bookedPerLead) },
  ];

  const pmRows = period === 'monthly' ? [
    { label: 'Booked', fn: (m: any) => fmt(m.booked), bold: true },
    { label: 'Cash Collected', fn: (m: any) => fmt(m.cashCollected) },
    { label: 'Total Leads', fn: (m: any) => m.totalLeads },
    { label: 'Total Closed', fn: (m: any) => m.totalClosed },
    { label: 'Closing %', fn: (m: any) => pct(m.closingPct) },
    { label: 'Avg Closed Sale $', fn: (m: any) => fmt(m.avgSale) },
    { label: 'Booked $ / Lead', fn: (m: any) => fmt(m.bookedPerLead) },
  ] : [
    { label: 'Total Booked Revenue', fn: (m: any) => fmt(m.booked), bold: true },
    { label: 'Total Leads', fn: (m: any) => m.totalLeads },
    { label: 'Total Closed', fn: (m: any) => m.totalClosed },
    { label: 'Closing %', fn: (m: any) => pct(m.closingPct) },
    { label: 'Avg Closed Sale $', fn: (m: any) => fmt(m.avgSale) },
    { label: 'Booked $ / Lead', fn: (m: any) => fmt(m.bookedPerLead) },
    { label: 'Trailing 4W BPL', fn: (m: any) => fmt(m.trailing4WeekBPL) },
  ];

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 12,
  };
  const thStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'right',
    fontSize: 11,
    fontWeight: 500,
    color: '#888780',
    borderBottom: '0.5px solid #E8E7E3',
    whiteSpace: 'nowrap',
    background: '#F8F7F4',
  };
  const tdStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'right',
    borderBottom: '0.5px solid #F1EFE8',
    whiteSpace: 'nowrap',
  };
  const rowLabelStyle: React.CSSProperties = {
    padding: '8px 12px',
    textAlign: 'left',
    fontSize: 11,
    color: '#888780',
    borderBottom: '0.5px solid #F1EFE8',
    whiteSpace: 'nowrap',
    background: '#F8F7F4',
    position: 'sticky',
    left: 0,
    zIndex: 2,
  };

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1400, margin: '0 auto' }}>

      {/* PM Manager Modal */}
      {showPMManager && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Manage PMs</div>
              <button onClick={() => setShowPMManager(false)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#888780' }}>X</button>
            </div>

            {/* Add new PM */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                type="text"
                placeholder="PM name"
                value={newPMName}
                onChange={e => setNewPMName(e.target.value)}
                style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '0.5px solid #B4B2A9', flex: 1 }}
              />
              <select value={newPMOffice} onChange={e => setNewPMOffice(e.target.value)} style={{ fontSize: 12, padding: '6px 10px', borderRadius: 6, border: '0.5px solid #B4B2A9' }}>
                {['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o}>{o}</option>)}
              </select>
              <button onClick={addPM} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 6, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                Add
              </button>
            </div>

            {/* PM list */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#F8F7F4' }}>
                  {['Name', 'Office', 'Active', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pms.map((pm: any) => (
                  <tr key={pm.id} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
                    <td style={{ padding: '8px 12px' }}>{pm.name}</td>
                    <td style={{ padding: '8px 12px', color: '#888780' }}>{pm.office}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: pm.active ? '#1D9E75' : '#A32D2D', fontWeight: 500 }}>{pm.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <button onClick={() => togglePM(pm.id, pm.active)} style={{ padding: '2px 8px', fontSize: 11, borderRadius: 4, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', color: '#888780' }}>
                        {pm.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', paddingTop: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Office:</span>
          {OFFICES.map(o => (
            <button key={o} onClick={() => setOffice(o)} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 20, border: '0.5px solid ' + (office === o ? ACCENT : '#D3D1C7'), background: office === o ? ACCENT : '#fff', color: office === o ? '#fff' : '#888780', cursor: 'pointer', fontWeight: office === o ? 500 : 400 }}>
              {o}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Monthly / Weekly toggle */}
          <div style={{ display: 'flex', borderRadius: 8, border: '0.5px solid #D3D1C7', overflow: 'hidden' }}>
            {(['monthly', 'weekly'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: '5px 14px', fontSize: 12, border: 'none', background: period === p ? ACCENT : '#fff', color: period === p ? '#fff' : '#888780', cursor: 'pointer', fontWeight: period === p ? 500 : 400 }}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={() => { setShowPMManager(true); fetchPMs(); }} style={{ padding: '5px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}>
            Manage PMs
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888780' }}>Loading...</div>
      ) : (
        <>
          {/* Company-wide KPI table */}
          <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
            Company-wide {period === 'monthly' ? 'Monthly' : 'Weekly'} KPIs
            {office !== 'All' && ' — ' + office}
          </div>
          <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #E8E7E3', overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 3 }}>Metric</th>
                    {labels.map((l: string) => <th key={l} style={thStyle}>{l}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {companyRows.map(row => (
                    <tr key={row.label}>
                      <td style={rowLabelStyle}>{row.label}</td>
                      {company.map((m: any, i: number) => (
                        <td key={i} style={{ ...tdStyle, fontWeight: row.bold ? 500 : 400, color: row.bold ? '#1D9E75' : '#2C2C2A' }}>
                          {row.fn(m)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* PM KPI tables */}
          {pmData.map((pm: any) => (
            <div key={pm.pm} style={{ marginBottom: 24 }}>
              <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14 }}>
                {pm.pm}
                <span style={{ fontSize: 11, color: '#888780', fontWeight: 400, marginLeft: 8 }}>{pm.office}</span>
              </div>
              <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #E8E7E3', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, zIndex: 3 }}>Metric</th>
                        {labels.map((l: string) => <th key={l} style={thStyle}>{l}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {pmRows.map(row => (
                        <tr key={row.label}>
                          <td style={rowLabelStyle}>{row.label}</td>
                          {(period === 'monthly' ? (pm.months || []) : (pm.weeks || [])).map((m: any, i: number) => (
                            <td key={i} style={{ ...tdStyle, fontWeight: row.bold ? 500 : 400, color: row.bold ? '#1D9E75' : '#2C2C2A' }}>
                              {row.fn(m)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
