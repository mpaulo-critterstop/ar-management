'use client';
import { useEffect, useState } from 'react';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, DataTable as CCDataTable, SearchBox as CCSearchBox, CustomerCell as CCCustomerCell } from '@/components/cc/Layout';
import { Btn as CCBtn, StatusPill as CCStatusPill } from '@/components/cc/Primitives';
import CCDatePicker from '@/components/cc/DatePicker';

const OFFICES = ['DFW', 'ATX', 'OKC', 'CStat'];
const CATEGORIES = ['All', 'Pest Control', 'Rodent Bundle', 'Termite'];

const catColor: Record<string, { bg: string; fg: string }> = {
  'Pest Control': { bg: '#e6f0ff', fg: '#0052cc' },
  'Rodent Bundle': { bg: '#fef0e6', fg: '#b45309' },
  'Termite': { bg: '#f0e6ff', fg: '#6b21a8' },
};
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export default function PestSalesPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [office, setOffice] = useState('DFW');
  const [pm, setPm] = useState('All');
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');            // All | Serviced | Pending
  const [saleFrom, setSaleFrom] = useState('');
  const [saleTo, setSaleTo] = useState('');
  const [initFrom, setInitFrom] = useState('');
  const [initTo, setInitTo] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pest-sales?office=${office}&pm=${encodeURIComponent(pm)}&category=${encodeURIComponent(category)}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [office, pm, category]);

  const inRange = (d: string | null, from: string, to: string) => {
    if (!d) return !from && !to ? true : false;   // no date: only passes when no range set
    const day = new Date(d).toISOString().slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };
  const sales = (data?.sales || []).filter((s: any) => {
    if (search && !s.customerName?.toLowerCase().includes(search.toLowerCase())) return false;
    if (status === 'Serviced' && !s.initialDone) return false;
    if (status === 'Pending' && s.initialDone) return false;
    if ((saleFrom && saleTo) && !inRange(s.saleDate, saleFrom, saleTo)) return false;
    if ((initFrom && initTo) && !inRange(s.initialCompletedAt, initFrom, initTo)) return false;
    return true;
  });
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', textTransform: 'uppercase', letterSpacing: '0.03em' };
  const td: React.CSSProperties = { padding: '9px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8' };
  const selStyle: React.CSSProperties = { fontSize: 12.5, padding: '8px 11px', borderRadius: 9, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8', cursor: 'pointer' };
  const dateStyle: React.CSSProperties = { fontSize: 12, padding: '6px 9px', borderRadius: 8, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8' };

  const catTone: any = { 'Pest Control': 'blue', 'Rodent Bundle': 'amber', 'Termite': 'violet' };
  const totalCV = sales.reduce((a: number, s: any) => a + (s.contractValue || 0), 0);
  const servicedN = sales.filter((s: any) => s.initialDone).length;
  const pendingN = sales.filter((s: any) => !s.initialDone).length;

  return (
    <div style={{ padding: '30px 34px 70px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#121216', margin: '0 -34px', padding: '2px 34px 6px' }}>
      <CCPageHeader icon="🐀" title="Pest Control Sales" subtitle="PM pest, rodent-bundle and termite sales with initial-service tracking" />

      {/* Office pills + filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          {OFFICES.map(o => { const on = office === o; return (
            <button key={o} onClick={() => setOffice(o)} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? '#5B9BE0' : '#2A2A30'}`, background: on ? '#15263a' : '#1C1C21', color: on ? '#5B9BE0' : '#908E85' }}>{o}</button>
          );})}
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)} style={selStyle}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={pm} onChange={e => setPm(e.target.value)} style={selStyle}>
          <option value="All">All PMs</option>
          {(data?.pmNames || []).map((p: string) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={selStyle}>
          <option value="All">All statuses</option>
          <option value="Serviced">Serviced</option>
          <option value="Pending">Pending initial</option>
        </select>
        <div style={{ marginLeft: 'auto', minWidth: 230 }}>
          <CCSearchBox value={search} onChange={setSearch} placeholder="Search customer…" />
        </div>
      </div>

      {/* Date-range filters */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#908E85' }}>Sale date:</span>
          <CCDatePicker value={saleFrom} onChange={setSaleFrom} placeholder="From" />
          <span style={{ fontSize: 12, color: '#63615A' }}>to</span>
          <CCDatePicker value={saleTo} onChange={setSaleTo} placeholder="To" />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#908E85' }}>Initial service:</span>
          <CCDatePicker value={initFrom} onChange={setInitFrom} placeholder="From" />
          <span style={{ fontSize: 12, color: '#63615A' }}>to</span>
          <CCDatePicker value={initTo} onChange={setInitTo} placeholder="To" />
        </div>
        {(saleFrom || saleTo || initFrom || initTo) && (
          <CCBtn variant="ghost" onClick={() => { setSaleFrom(''); setSaleTo(''); setInitFrom(''); setInitTo(''); }}>Clear dates</CCBtn>
        )}
      </div>
      </div>

      {/* KPI strip */}
      <CCKpiStrip items={[
        { icon: '🐀', label: 'Sales', value: loading ? '…' : sales.length, tone: 'blue' },
        { icon: '💵', label: 'Contract value', value: loading ? '…' : money(totalCV), tone: 'green' },
        { icon: '✅', label: 'Serviced', value: loading ? '…' : servicedN, tone: 'green' },
        { icon: '⏳', label: 'Pending initial', value: loading ? '…' : pendingN, tone: 'amber' },
      ]} />

      {/* Table */}
      <CCDataTable
        rowKey={(s: any) => s.id}
        empty={loading ? 'Loading…' : 'No pest sales for these filters.'}
        cols={[
          { key: 'cust', label: 'Customer', render: (s: any) => <CCCustomerCell name={s.customerName || `#${s.customerId}`} sub={s.pmName || undefined} /> },
          { key: 'cat', label: 'Category', render: (s: any) => <CCStatusPill tone={catTone[s.category] || 'neutral'}>{s.category}</CCStatusPill> },
          { key: 'service', label: 'Service', wrap: true, render: (s: any) => <span style={{ color: '#C9C7BF', fontSize: 12.5 }}>{s.category === 'Rodent Bundle' ? (s.chargeChildService ? `Bundle · ${s.chargeChildService}` : 'Bundle') : s.serviceName}</span> },
          { key: 'cv', label: 'Contract Value', align: 'right', render: (s: any) => <span style={{ fontWeight: 700, color: '#F0EEE8', fontVariantNumeric: 'tabular-nums' }}>{money(s.contractValue)}</span> },
          { key: 'saleDate', label: 'Sale date', render: (s: any) => <span style={{ color: '#908E85', fontSize: 12.5 }}>{fmtDate(s.saleDate)}</span> },
          { key: 'initDate', label: 'Initial service', render: (s: any) => <span style={{ color: '#908E85', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{s.initialDone ? fmtDate(s.initialCompletedAt) : '—'}</span> },
          { key: 'status', label: 'Status', render: (s: any) => s.initialDone ? <CCStatusPill tone="green">Serviced</CCStatusPill> : <CCStatusPill tone="amber">Pending</CCStatusPill> },
        ]}
        rows={sales}
      />
    </div>
  );
}
