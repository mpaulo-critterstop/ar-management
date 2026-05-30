'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];
const STATUSES = ['All', 'SOLD', 'INSPECTED', 'PENDING'];

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function pct(n: number) {
  return n.toFixed(1) + '%';
}

export default function LeadsPage() {
  const sessionData = useSession();
  const session = sessionData?.data;
  const status = sessionData?.status;
  const router = useRouter();

  const [leads, setLeads] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [pmKpis, setPmKpis] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [office, setOffice] = useState('DFW');
  const [statusFilter, setStatusFilter] = useState('All');
  const [pmFilter, setPmFilter] = useState('All');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (office !== 'All') params.set('office', office);
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (pmFilter !== 'All') params.set('pm', pmFilter);
    if (from) params.set('from', from);
    if (to) params.set('to', to);

    const res = await fetch(`/api/leads?${params}`);
    const data = await res.json();
    setLeads(data.leads || []);
    setKpis(data.kpis || null);
    setPmKpis(data.pmKpis || []);
    setLoading(false);
  }, [office, statusFilter, pmFilter, from, to]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const pms = ['All', ...Array.from(new Set(leads.map((l: any) => l.pmName).filter(Boolean)))];

  if (status === 'loading') return null;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', background: '#F8F7F4', minHeight: '100vh' }}>
      {/* Top nav */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E8E7E3', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 52 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, fontSize: 15 }}>
          🦝 Critter Stop — Wildlife Operations
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[{ label: 'Leads', href: '/leads', active: true }, { label: 'Dispatcher', href: '/dispatch', active: false }, { label: 'AR', href: '/dashboard', active: false }].map(tab => (
            <a key={tab.href} href={tab.href} style={{ padding: '14px 16px', fontSize: 13, fontWeight: tab.active ? 500 : 400, color: tab.active ? '#1D9E75' : '#888780', borderBottom: tab.active ? '2px solid #1D9E75' : '2px solid transparent', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
              {tab.label}
            </a>
          ))}
        </div>
        <div style={{ fontSize: 13, color: '#888780' }}>{session?.user?.email}</div>
      </div>

      <div style={{ padding: 20 }}>
        {/* Office switcher */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Office:</span>
          {OFFICES.map(o => (
            <button key={o} onClick={() => setOffice(o)} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 20, border: '1px solid ' + (office === o ? '#1D9E75' : '#D3D1C7'), background: office === o ? '#1D9E75' : '#fff', color: office === o ? '#fff' : '#888780', cursor: 'pointer', fontWeight: office === o ? 500 : 400 }}>
              {o}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Filters:</span>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid #D3D1C7', background: '#fff' }}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={pmFilter} onChange={e => setPmFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid #D3D1C7', background: '#fff' }}>
            {pms.map(p => <option key={p}>{p}</option>)}
          </select>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid #D3D1C7' }} />
          <span style={{ fontSize: 12, color: '#888780' }}>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '1px solid #D3D1C7' }} />
        </div>

        {/* KPI cards */}
        {kpis && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total leads', value: kpis.total, sub: 'All inspections' },
              { label: 'Sold', value: kpis.sold, sub: '+' + kpis.inspected + ' inspected', color: '#1D9E75' },
              { label: 'Conversion rate', value: pct(kpis.conversionRate), sub: 'Sold / Total' },
              { label: 'Booked revenue', value: fmt(kpis.bookedRevenue), sub: 'Avg ' + fmt(kpis.avgSale), color: '#1D9E75' },
            ].map(card => (
              <div key={card.label} style={{ background: '#F1EFE8', borderRadius: 8, padding: '14px 16px' }}>
                <div style={{ fontSize: 12, color: '#888780', marginBottom: 6 }}>{card.label}</div>
                <div style={{ fontSize: 22, fontWeight: 500, color: card.color || '#2C2C2A' }}>{loading ? '...' : card.value}</div>
                <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2 }}>{card.sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Lead records table */}
        <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14 }}>Lead records</div>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8E7E3', overflow: 'hidden', marginBottom: 24 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F8F7F4' }}>
                {['Customer', 'Date', 'PM', 'Status', 'Invoice', 'Amount', 'Office'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '1px solid #E8E7E3' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>Loading...</td></tr>
              ) : leads.slice(0, 100).map((lead: any) => (
                <tr key={lead.id} style={{ borderBottom: '1px solid #F1EFE8' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{lead.customer?.name || '—'}</td>
                  <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.inspectionDate ? new Date(lead.inspectionDate).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{lead.pmName || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                      background: lead.status === 'SOLD' ? '#E1F5EE' : lead.status === 'INSPECTED' ? '#E6F1FB' : '#FAEEDA',
                      color: lead.status === 'SOLD' ? '#0F6E56' : lead.status === 'INSPECTED' ? '#185FA5' : '#854F0B',
                    }}>{lead.status}</span>
                  </td>
                  <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.invoice?.externalId ? '#' + lead.invoice.externalId : '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{lead.amount ? fmt(lead.amount) : '—'}</td>
                  <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.office}</td>
                </tr>
              ))}
              {!loading && leads.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>No leads found</td></tr>
              )}
            </tbody>
          </table>
          {leads.length > 100 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#888780', borderTop: '1px solid #E8E7E3' }}>
              Showing 100 of {leads.length} leads
            </div>
          )}
        </div>

        {/* PM KPIs table */}
        <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14 }}>KPIs by PM</div>
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8E7E3', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#F8F7F4' }}>
                {['PM', 'Total leads', 'Sold', 'Close %', 'Avg sale', 'Booked revenue'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '1px solid #E8E7E3' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>Loading...</td></tr>
              ) : pmKpis.map((pm: any) => (
                <tr key={pm.pmName} style={{ borderBottom: '1px solid #F1EFE8' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{pm.pmName}</td>
                  <td style={{ padding: '10px 12px' }}>{pm.total}</td>
                  <td style={{ padding: '10px 12px', color: '#1D9E75', fontWeight: 500 }}>{pm.sold}</td>
                  <td style={{ padding: '10px 12px' }}>{pct(pm.conversionRate)}</td>
                  <td style={{ padding: '10px 12px' }}>{fmt(pm.avgSale)}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{fmt(pm.bookedRevenue)}</td>
                </tr>
              ))}
              {!loading && pmKpis.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
