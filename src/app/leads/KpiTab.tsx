'use client';

import { useState, useEffect } from 'react';

const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function pct(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toFixed(1) + '%';
}

// KPI content rendered as a tab inside the Leads Tracker. Logic is identical to the former
// standalone /kpi page — same state, same /api/kpi/leads + /api/pm fetches, same tables and
// PM Manager. Only the page wrapper (auth redirect, outer padding, back button) was removed.
export function KpiTab() {
  const [office, setOffice] = useState('All');
  const [period, setPeriod] = useState<'monthly' | 'weekly'>('monthly');
  const [companyCount, setCompanyCount] = useState(12); // company table period count; grows via Load more
  const [pmFilter, setPmFilter] = useState('All');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPMManager, setShowPMManager] = useState(false);
  const [pms, setPms] = useState<any[]>([]);
  const [newPMName, setNewPMName] = useState('');
  const [newPMOffice, setNewPMOffice] = useState('DFW');
  const [newPMMethod, setNewPMMethod] = useState('');

  useEffect(() => {
    fetchKPIs();
    fetchPMs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office, period, companyCount]);

  // Reset company table back to 12 when the office or period toggle changes.
  useEffect(() => { setCompanyCount(12); }, [office, period]);

  async function fetchKPIs() {
    setLoading(true);
    const params = new URLSearchParams();
    if (office !== 'All') params.set('office', office);
    params.set('period', period);
    if (companyCount > 12) params.set('companyCount', String(companyCount));
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
      body: JSON.stringify({ name: newPMName.trim(), office: newPMOffice, commissionMethod: newPMMethod || undefined }),
    });
    setNewPMName('');
    setNewPMMethod('');
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

  async function changePMMethod(id: string, commissionMethod: string) {
    await fetch('/api/pm', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, commissionMethod }),
    });
    fetchPMs();
  }

  const labels = data?.labels || [];
  const company = data?.company || [];
  const pmData = (data?.pms || [])
    .filter((pm: any) => office === 'All' || pm.office.toLowerCase() === office.toLowerCase())
    .filter((pm: any) => pmFilter === 'All' || pm.pm === pmFilter);

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

  // Export the KPI tables (company + each PM) to CSV — mirrors exactly what's displayed,
  // respecting the current office / period / PM filters. Opens in Excel for charting.
  const exportCSV = () => {
    const esc = (v: any) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [];
    const periodLabel = period === 'monthly' ? 'Monthly' : 'Weekly';
    lines.push(esc(`Lead KPIs - ${periodLabel}${office !== 'All' ? ` - ${office}` : ''}`));
    lines.push('');
    // Company-wide block
    lines.push('Company-wide');
    lines.push(['Metric', ...labels].map(esc).join(','));
    for (const row of companyRows) {
      lines.push([row.label, ...company.map((m: any) => row.fn(m))].map(esc).join(','));
    }
    lines.push('');
    // Per-PM blocks
    for (const pm of pmData) {
      lines.push(`${pm.pm}${pm.office ? ` (${pm.office})` : ''}`);
      lines.push(['Metric', ...labels].map(esc).join(','));
      const series = period === 'monthly' ? (pm.months || []) : (pm.weeks || []);
      for (const row of pmRows) {
        lines.push([row.label, ...series.map((m: any) => row.fn(m))].map(esc).join(','));
      }
      lines.push('');
    }
    const csv = lines.join('\n');
    // Prepend a UTF-8 BOM so Excel reads the file as UTF-8 (otherwise em dashes / accented
    // names get mangled into sequences like "â€”").
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lead-kpis-${period}${office !== 'All' ? '-' + office : ''}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'right', fontSize: 11, fontWeight: 500, color: '#888780',
    borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', background: '#F8F7F4',
  };
  const tdStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'right', borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap',
  };
  const rowLabelStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#888780',
    borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap', background: '#F8F7F4',
    position: 'sticky', left: 0, zIndex: 2,
  };

  return (
    <div>
      {/* PM Manager Modal */}
      {showPMManager && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 500, fontSize: 15, color: '#2C2C2A' }}>Manage PMs</div>
              <button onClick={() => setShowPMManager(false)} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#888780' }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <input type="text" placeholder="PM name" value={newPMName} onChange={e => setNewPMName(e.target.value)}
                style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', flex: 1, color: '#2C2C2A' }} />
              <select value={newPMOffice} onChange={e => setNewPMOffice(e.target.value)}
                style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', color: '#2C2C2A' }}>
                {['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
              <select value={newPMMethod} onChange={e => setNewPMMethod(e.target.value)}
                style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', color: '#2C2C2A', flex: 1 }}>
                <option value="">No commission plan</option>
                <option value="abr_tiered">Structure 1 — Booked Revenue Tier (8/10/12%, $80k floor)</option>
                <option value="abr_adrian">Structure 2 — Booked Revenue Tier (5/7%)</option>
                <option value="abr_cynthia">Structure 2b — Booked Revenue Tier (5/7%, $15k)</option>
                <option value="lead_bucket">Structure 3 — Lead buckets (8/10/12/14% by rev/lead)</option>
              </select>
              <button onClick={addPM} style={{ padding: '7px 14px', fontSize: 13, borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', cursor: 'pointer', fontWeight: 500 }}>
                Add
              </button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#F8F7F4' }}>
                  {['Name', 'Office', 'Commission', 'Active', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pms.map((pm: any) => (
                  <tr key={pm.id} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
                    <td style={{ padding: '8px 12px', color: '#2C2C2A' }}>{pm.name}</td>
                    <td style={{ padding: '8px 12px', color: '#888780' }}>{pm.office}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <select
                        value={pm.commissionMethod || ''}
                        onChange={e => changePMMethod(pm.id, e.target.value)}
                        style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '0.5px solid #D3D1C7', color: '#2C2C2A', background: pm.commissionMethod ? '#fff' : '#FAF8F2' }}
                        title="Change commission structure (takes effect from the current month; past months keep their old plan)"
                      >
                        <option value="">None</option>
                        <option value="abr_tiered">Structure 1 (8/10/12%)</option>
                        <option value="abr_adrian">Structure 2 (5/7%)</option>
                        <option value="abr_cynthia">Structure 2b (5/7%, $15k)</option>
                        <option value="lead_bucket">Structure 3 (buckets)</option>
                      </select>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: pm.active ? '#1D9E75' : '#A32D2D', fontWeight: 500 }}>{pm.active ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <button onClick={() => togglePM(pm.id, pm.active)} style={{ padding: '4px 10px', fontSize: 11, borderRadius: 6, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', color: '#888780' }}>
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

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
          {OFFICES.map(o => (
            <button key={o} onClick={() => setOffice(o)} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: office === o ? '#2C2C2A' : '#888780', background: office === o ? '#ffffff' : 'transparent', border: office === o ? '0.5px solid #D3D1C7' : '0.5px solid transparent', boxShadow: office === o ? '0 1px 3px rgba(44,44,42,0.08)' : 'none', cursor: 'pointer' }}>
              {o}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
            {(['monthly', 'weekly'] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: period === p ? '#2C2C2A' : '#888780', background: period === p ? '#ffffff' : 'transparent', border: period === p ? '0.5px solid #D3D1C7' : '0.5px solid transparent', boxShadow: period === p ? '0 1px 3px rgba(44,44,42,0.08)' : 'none', cursor: 'pointer' }}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <button onClick={() => { setShowPMManager(true); fetchPMs(); }} style={{ padding: '7px 14px', fontSize: 13, borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer', fontWeight: 500 }}>
            Manage PMs
          </button>
          <button onClick={exportCSV} style={{ padding: '7px 14px', fontSize: 13, borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', cursor: 'pointer', fontWeight: 500 }}>
            Export CSV
          </button>
          <select value={pmFilter} onChange={e => setPmFilter(e.target.value)} style={{ fontSize: 13, padding: '7px 12px', borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', cursor: 'pointer' }}>
            <option value="All">All PMs</option>
            {pms.map((pm: any) => <option key={pm.id} value={pm.name}>{pm.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888780' }}>Loading...</div>
      ) : (
        <>
          {/* Company-wide KPI table */}
          <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14, color: '#2C2C2A' }}>
            Company-wide {period === 'monthly' ? 'Monthly' : 'Weekly'} KPIs
            {office !== 'All' && <span style={{ fontSize: 12, color: '#888780', fontWeight: 400, marginLeft: 8 }}>— {office}</span>}
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

          {/* Load more — extends the company table with older periods (scroll right to see history).
              Per-PM tables stay at the rolling 12. Pre-2026 columns show locked legacy numbers. */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: -12, marginBottom: 24 }}>
            <button onClick={() => setCompanyCount(c => c + 12)}
              style={{ padding: '7px 16px', fontSize: 13, borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', cursor: 'pointer', fontWeight: 500 }}>
              Load 12 earlier {period === 'monthly' ? 'months' : 'weeks'} →
            </button>
            {companyCount > 12 && (
              <button onClick={() => setCompanyCount(12)}
                style={{ padding: '7px 16px', fontSize: 13, borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer', fontWeight: 500 }}>
                Reset
              </button>
            )}
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
                        {(data.pmLabels || labels).map((l: string) => <th key={l} style={thStyle}>{l}</th>)}
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
