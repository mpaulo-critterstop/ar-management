'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CommissionsTab } from './CommissionsTab';
import { canAccessModule, perm } from '@/lib/access';

const ACCENT = '#0052cc';
const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number) { return n.toFixed(1) + '%'; }

function parseCSV(text: string): any[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(delimiter);
    const row: any = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return {
      fr_id: row['fr_id'] || row['fr id'] || row['customer_id'] || '',
      invoice_id: row['invoice_id'] || row['invoice id'] || row['ticket_id'] || '',
      pm: row['pm'] || row['pm_name'] || '',
      inspection_date: row['inspection_date'] || row['inspection date'] || '',
      sold: row['sold?'] || row['sold'] || '',
      amount_booked: row['amount_booked'] || row['amount booked'] || row['amount'] || '0',
    };
  }).filter(r => r.fr_id);
}

export default function LeadsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Main leads state
  const [leads, setLeads] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [pmKpis, setPmKpis] = useState<any[]>([]);
  const [allPMs, setAllPMs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [office, setOffice] = useState('DFW');
  const [statusFilter, setStatusFilter] = useState('All');
  const [statusInput, setStatusInput] = useState('All');
  const [pmInput, setPmInput] = useState('All');
  const [pmFilter, setPmFilter] = useState('All');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Tab state
  const [activeTab, setActiveTab] = useState<'leads' | 'csr' | 'commissions'>('leads');

  // Honor ?tab= for deep links (e.g. the CSR home tile → /leads?tab=csr).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'csr' || t === 'commissions' || t === 'leads') setActiveTab(t as any);
  }, []);

  // Access: full leads module unlocks Leads/KPIs/Commissions; csr-only users see only the CSR tab.
  const sUser = session?.user as any;
  const canLeads = canAccessModule(sUser, 'leads');
  const canCsr = canAccessModule(sUser, 'csr');
  const canKpis = canLeads && !perm(sUser, 'hidePmKpis');
  const canCommissions = canLeads;

  // If the user can't see the current tab, move them to one they can.
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (activeTab === 'leads' && !canLeads) setActiveTab(canCsr ? 'csr' : 'commissions');
    if (activeTab === 'commissions' && !canCommissions) setActiveTab(canLeads ? 'leads' : 'csr');
    if (activeTab === 'csr' && !canCsr) setActiveTab(canLeads ? 'leads' : 'commissions');
  }, [status, activeTab, canLeads, canCsr, canCommissions]);

  // CSR tab state
  const [csrStats, setCsrStats] = useState<any[]>([]);
  const [csrKpis, setCsrKpis] = useState<any>(null);
  const [csrLoading, setCsrLoading] = useState(false);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth(); // 0-indexed
  const [csrSelectedYear, setCsrSelectedYear] = useState(currentYear);
  const [csrSelectedMonth, setCsrSelectedMonth] = useState(currentMonth);
  const [csrFrom, setCsrFrom] = useState(() => {
    const d = new Date(currentYear, currentMonth, 1);
    return d.toISOString().split('T')[0];
  });
  const [csrTo, setCsrTo] = useState(() => {
    const d = new Date(currentYear, currentMonth + 1, 0);
    return d.toISOString().split('T')[0];
  });
  const [showManageCSR, setShowManageCSR] = useState(false);
  const [csrEmployees, setCsrEmployees] = useState<any[]>([]);
  const [newCSRName, setNewCSRName] = useState('');
  const [showAddCSR, setShowAddCSR] = useState(false);
  const [drawerCSR, setDrawerCSR] = useState<any>(null);
  const [drawerData, setDrawerData] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importOffice, setImportOffice] = useState('DFW');
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (office !== 'All') params.set('office', office);
    if (statusFilter !== 'All') params.set('status', statusFilter);
    if (pmFilter !== 'All') params.set('pm', pmFilter);
    if (from || to) {
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('dateField', statusFilter === 'SOLD' ? 'sold' : statusFilter === 'INSPECTED' ? 'inspection' : 'all');
    }
    const res = await fetch('/api/leads?' + params.toString());
    const data = await res.json();
    setLeads(data.leads || []);
    setKpis(data.kpis || null);
    setPmKpis(data.pmKpis || []);
    setCurrentPage(1);
    setLoading(false);
  }, [office, statusFilter, pmFilter, from, to]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const fetchCSR = useCallback(async () => {
    setCsrLoading(true);
    const params = new URLSearchParams();
    if (csrFrom) params.set('from', csrFrom);
    if (csrTo) params.set('to', csrTo);
    const res = await fetch('/api/leads/csr?' + params.toString());
    const data = await res.json();
    setCsrStats(data.csrStats || []);
    setCsrKpis(data.kpis || null);
    setCsrLoading(false);
  }, [csrFrom, csrTo]);

  useEffect(() => { if (activeTab === 'csr') fetchCSR(); }, [activeTab, fetchCSR]);

  const fetchCSREmployees = useCallback(async () => {
    const res = await fetch('/api/leads/csr-employees');
    const data = await res.json();
    setCsrEmployees(data.employees || []);
  }, []);

  useEffect(() => { if (showManageCSR) fetchCSREmployees(); }, [showManageCSR, fetchCSREmployees]);

  useEffect(() => {
    fetch('/api/pm')
      .then(r => r.json())
      .then(d => setAllPMs(['All', ...d.filter((p: any) => p.active).map((p: any) => p.name).sort()]));
  }, []);

  const pms = allPMs.length > 1 ? allPMs : ['All'];
  const filtered = search ? leads.filter((l: any) => l.customer?.name?.toLowerCase().includes(search.toLowerCase())) : leads;
  const totalPages = Math.ceil(filtered.length / pageSize);
  const displayed = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const pageNums = () => {
    const pages: number[] = [];
    if (totalPages <= 7) { for (let i = 1; i <= totalPages; i++) pages.push(i); }
    else {
      pages.push(1);
      if (currentPage > 3) pages.push(-1);
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push(-1);
      pages.push(totalPages);
    }
    return pages;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setImportRows(parseCSV(text));
      setImportResult(null);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importRows.length || !importOffice) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ office: importOffice, rows: importRows }),
      });
      const data = await res.json();
      setImportResult(data);
      if (data.created > 0 || data.updated > 0) {
        fetchLeads();
        setTimeout(() => setShowImport(false), 2000);
      }
    } catch {
      setImportResult({ error: 'Import failed' });
    }
    setImporting(false);
  };

  if (status === 'loading') return null;

  return (
    <div style={{ padding: '0 24px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Title */}
      <div style={{ paddingTop: 24, marginBottom: 4 }}>
        <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>Leads Tracker</h1>
      </div>

      {/* Nav bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', paddingTop: 20 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 12, background: '#F1EFE8', border: '0.5px solid #E8E7E3' }}>
            {canLeads && OFFICES.map(o => (
              <button key={o} onClick={() => { setOffice(o); setActiveTab('leads'); }} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: activeTab === 'leads' && office === o ? '#2C2C2A' : '#888780', background: activeTab === 'leads' && office === o ? '#ffffff' : 'transparent', border: activeTab === 'leads' && office === o ? '0.5px solid #D3D1C7' : '0.5px solid transparent', cursor: 'pointer' }}>
                {o}
              </button>
            ))}
            {canKpis && <>
              <div style={{ width: '0.5px', background: '#D3D1C7', height: 20, margin: '0 2px' }} />
              <button onClick={() => router.push('/kpi')} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: '#888780', background: 'transparent', border: '0.5px solid transparent', cursor: 'pointer' }}>
                KPIs
              </button>
            </>}
            {canCsr && <>
              <div style={{ width: '0.5px', background: '#D3D1C7', height: 20, margin: '0 2px' }} />
              <button onClick={() => setActiveTab('csr')} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: activeTab === 'csr' ? '#0052cc' : '#888780', background: activeTab === 'csr' ? '#e6f0ff' : 'transparent', border: activeTab === 'csr' ? '0.5px solid #b3d0ff' : '0.5px solid transparent', cursor: 'pointer' }}>
                CSR leads tracker
              </button>
            </>}
            {canCommissions && (
              <button onClick={() => setActiveTab('commissions')} style={{ padding: '7px 14px', borderRadius: 9, fontSize: 13, fontWeight: 500, color: activeTab === 'commissions' ? '#0052cc' : '#888780', background: activeTab === 'commissions' ? '#e6f0ff' : 'transparent', border: activeTab === 'commissions' ? '0.5px solid #b3d0ff' : '0.5px solid transparent', cursor: 'pointer' }}>
                Commissions
              </button>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            if (syncing) return;
            setSyncing(true);
            // Step 1: Sync main wildlife leads
            await fetch('/api/sync/appointments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'critterstop-cron-2024' },
              body: JSON.stringify({}),
            });
            // Step 2: Sync new CSR appointment types (runs for each office)
            for (const office of ['DFW', 'ATX', 'OKC', 'CStat']) {
              await fetch(`/api/sync/csr-appointments?token=critterstop2026&office=${office}`);
            }
            // Step 3: Fix wildlife records with missing employeeId
            let wildlifeFixDone = false;
            let wildlifeFixUrl = '/api/sync/csr-wildlife-fix?token=critterstop2026&offset=0';
            while (!wildlifeFixDone) {
              const wRes = await fetch('https://hub.critterstop.com' + wildlifeFixUrl);
              const wData = await wRes.json();
              if (wData.hasMore && wData.nextUrl) {
                wildlifeFixUrl = wData.nextUrl;
              } else {
                wildlifeFixDone = true;
              }
            }
            // Step 4: Run incremental CSR backfill for new records
            await fetch('/api/leads/csr-backfill?token=critterstop2026&mode=incremental');
            await fetchLeads();
            setSyncing(false);
          }}
          disabled={syncing}
          style={{ background: '#fff', color: '#888780', border: '0.5px solid #D3D1C7', padding: '7px 14px', borderRadius: 9, cursor: syncing ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: syncing ? 0.7 : 1 }}
        >
          {syncing ? (<><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #D3D1C7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />Syncing...</>) : '⟳ Sync FR'}
        </button>
      </div>

      {/* LEADS TAB */}
      {activeTab === 'leads' && canLeads && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#888780' }}>Filters:</span>
              <input type="text" placeholder="Search customer..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', minWidth: 180 }} />
              <select value={statusInput} onChange={e => setStatusInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
                <option value="All">All</option>
                <option value="SOLD">Sold</option>
              </select>
              <select value={pmInput} onChange={e => setPmInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
                {pms.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={fromInput} onChange={e => setFromInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
              <span style={{ fontSize: 12, color: '#888780' }}>to</span>
              <input type="date" value={toInput} onChange={e => setToInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
              <button onClick={() => { setFrom(fromInput); setTo(toInput); setStatusFilter(statusInput); setPmFilter(pmInput); }} style={{ padding: '7px 14px', fontSize: 13, borderRadius: 9, border: '0.5px solid #D3D1C7', background: '#fff', color: '#2C2C2A', cursor: 'pointer', fontWeight: 500 }}>Apply</button>
              {(from || to || statusFilter !== 'All' || pmFilter !== 'All') && (
                <button onClick={() => { setFrom(''); setTo(''); setFromInput(''); setToInput(''); setStatusFilter('All'); setStatusInput('All'); setPmFilter('All'); setPmInput('All'); }} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}>Clear</button>
              )}
            </div>
          </div>

          {/* KPI cards */}
          {kpis && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Total leads', value: kpis.total, sub: 'All inspections', accent: '#0052cc' },
                { label: 'Sold', value: kpis.sold, sub: '+' + kpis.inspected + ' inspected', color: '#1D9E75', accent: '#1D9E75' },
                { label: 'Conversion rate', value: pct(kpis.conversionRate), sub: 'Sold / Total', accent: '#BA7517' },
                { label: 'Booked revenue', value: fmt((kpis.bookedRevenue || 0) + (kpis.upsellRevenue || 0)), sub: 'Avg ' + fmt(kpis.avgSale), color: '#1D9E75', accent: '#1D9E75' },
              ].map(card => (
                <div key={card.label} style={{ background: '#fff', borderRadius: 12, padding: '14px 18px', border: '0.5px solid #E8E7E3', borderLeft: `3px solid ${(card as any).accent}` }}>
                  <div style={{ fontSize: 11, color: '#888780', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{card.label}</div>
                  <div style={{ fontSize: 28, fontWeight: 500, color: (card as any).color || '#2C2C2A' }}>{loading ? '...' : card.value}</div>
                  <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2 }}>{card.sub}</div>
                </div>
              ))}
            </div>
          )}

          {/* Lead records table */}
          <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14 }}>Lead records</div>
          <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #E8E7E3', overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                  <tr style={{ background: '#F8F7F4' }}>
                    {['Customer', 'Inspection Date', 'Sold Date', 'PM', 'Status', 'Invoice', 'Amount', 'Office'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>Loading...</td></tr>
                  ) : displayed.flatMap((lead: any) => {
                    const rows = [];

                    // Determine if primary row should show based on date filter
                    const invoiceDate = lead.invoice?.date ? lead.invoice.date.split('T')[0] : null;
                    const fromDate = from || null;
                    const toDate = to || null;
                    const noDateFilter = !fromDate && !toDate;
                    // For SOLD leads with a date filter, only show if invoice date is in range
                    // For INSPECTED leads, always show the primary row (no invoice date to check)
                    const primaryInRange = noDateFilter ||
                      statusFilter !== 'SOLD' ||
                      lead.status !== 'SOLD' ||
                      (invoiceDate !== null && (!fromDate || invoiceDate >= fromDate) && (!toDate || invoiceDate <= toDate));

                    if (primaryInRange) {
                      rows.push(
                      <tr key={lead.id} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{lead.customer?.name || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.inspectionDate ? lead.inspectionDate.split('T')[0] : '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.invoice?.date ? lead.invoice.date.split('T')[0] : '—'}</td>
                        <td style={{ padding: '10px 12px' }}>{lead.pmName || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: lead.status === 'SOLD' ? '#E1F5EE' : lead.status === 'INSPECTED' ? '#E6F1FB' : '#FAEEDA', color: lead.status === 'SOLD' ? '#0F6E56' : lead.status === 'INSPECTED' ? '#185FA5' : '#854F0B' }}>
                            {lead.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.invoice?.externalId || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>{lead.amount ? fmt(lead.amount) : '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.office}</td>
                      </tr>
                      );
                    }
                    if (lead.upsellAmount && lead.upsellDate) {
                      const upsellDateStr = lead.upsellDate.split('T')[0];
                      const upsellInRange = noDateFilter ||
                        ((!fromDate || upsellDateStr >= fromDate) && (!toDate || upsellDateStr <= toDate));
                      if (upsellInRange) {
                        rows.push(
                        <tr key={lead.id + '_upsell'} style={{ borderBottom: '0.5px solid #F1EFE8', background: '#FDFCF8' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 500 }}>{lead.customer?.name || '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.inspectionDate ? lead.inspectionDate.split('T')[0] : '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.upsellDate.split('T')[0]}</td>
                          <td style={{ padding: '10px 12px' }}>{lead.pmName || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: '#F0EAFD', color: '#6B3FA0' }}>
                              Upsell
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.upsellInvoice?.externalId || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{fmt(lead.upsellAmount)}</td>
                          <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.office}</td>
                        </tr>
                      );
                      }
                    }
                    return rows;
                  })}
                  {!loading && leads.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>No leads found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '0.5px solid #E8E7E3', background: '#F8F7F4', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#888780' }}>
                Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} leads
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} style={{ fontSize: 12, padding: '2px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4, marginLeft: 6 }}>
                  <option value={100}>100</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select> per page
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #D3D1C7', borderRadius: 4, background: currentPage === 1 ? '#F8F7F4' : '#fff', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
                {pageNums().map((p, i) => p === -1
                  ? <span key={i} style={{ padding: '3px 6px', fontSize: 12 }}>…</span>
                  : <button key={p} onClick={() => setCurrentPage(p)} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #D3D1C7', borderRadius: 4, background: currentPage === p ? ACCENT : '#fff', color: currentPage === p ? '#fff' : '#2C2C2A', cursor: 'pointer' }}>{p}</button>
                )}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #D3D1C7', borderRadius: 4, background: currentPage === totalPages ? '#F8F7F4' : '#fff', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* CSR LEADS TRACKER TAB */}
      {activeTab === 'csr' && canCsr && (
        <div style={{ marginTop: 16 }}>
          {/* Year + Month selector */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {[currentYear - 1, currentYear].filter(y => y >= 2026).concat(currentYear < new Date().getFullYear() ? [currentYear + 1] : []).map(y => (
                  <button key={y} onClick={() => {
                    setCsrSelectedYear(y);
                    const m = csrSelectedMonth;
                    const from = new Date(y, m, 1).toISOString().split('T')[0];
                    const to = new Date(y, m + 1, 0).toISOString().split('T')[0];
                    setCsrFrom(from); setCsrTo(to);
                  }} style={{ padding: '5px 16px', fontSize: 13, borderRadius: 8, border: '0.5px solid #D3D1C7', cursor: 'pointer', fontWeight: 500, background: csrSelectedYear === y ? '#0052cc' : '#fff', color: csrSelectedYear === y ? '#fff' : '#444441' }}>
                    {y}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowManageCSR(true)} style={{ padding: '7px 14px', fontSize: 13, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#444441' }}>
                👥 Manage CSRs
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((month, idx) => {
                const isSelected = csrSelectedMonth === idx;
                const isFuture = csrSelectedYear === currentYear && idx > currentMonth;
                return (
                  <button key={month} disabled={isFuture} onClick={() => {
                    setCsrSelectedMonth(idx);
                    const from = new Date(csrSelectedYear, idx, 1).toISOString().split('T')[0];
                    const to = new Date(csrSelectedYear, idx + 1, 0).toISOString().split('T')[0];
                    setCsrFrom(from); setCsrTo(to);
                  }} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', cursor: isFuture ? 'not-allowed' : 'pointer', fontWeight: isSelected ? 500 : 400, background: isSelected ? '#0052cc' : isFuture ? '#F1EFE8' : '#fff', color: isSelected ? '#fff' : isFuture ? '#C4C2B8' : '#444441' }}>
                    {month}
                  </button>
                );
              })}
            </div>
          </div>

          {csrKpis && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Completed leads', value: csrKpis.completedLeads },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: '#F1EFE8', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontSize: 12, color: '#888780', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 500, color: '#2C2C2A' }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {csrLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#888780' }}>Loading...</div>
          ) : (
            <div style={{ background: '#fff', border: '0.5px solid #D3D1C7', borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '0.5px solid #D3D1C7', background: '#F9F8F5' }}>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500, color: '#888780', width: 40 }}>#</th>
                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500, color: '#888780' }}>CSR name</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#888780', width: 100 }}>Completed</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#888780', width: 140 }}>Rescheduled by others</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#888780', width: 150 }}>Rescheduled from others</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#888780', width: 90 }}>Total leads</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#888780', width: 80 }}>Points</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 500, color: '#888780', width: 80 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {csrStats.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: '#888780' }}>No CSR data yet — run the backfill first.</td></tr>
                  ) : csrStats.map((csr, i) => (
                    <tr key={csr.name} onClick={async () => {
                      setDrawerCSR(csr);
                      setDrawerData(null);
                      setDrawerLoading(true);
                      const params = new URLSearchParams({ csrName: csr.name });
                      if (csrFrom) params.set('from', csrFrom);
                      if (csrTo) params.set('to', csrTo);
                      const res = await fetch('/api/leads/csr-detail?' + params.toString());
                      const data = await res.json();
                      setDrawerData(data);
                      setDrawerLoading(false);
                    }} style={{ borderBottom: '0.5px solid #E8E7E3', background: i % 2 === 0 ? '#fff' : '#FAFAF8', cursor: 'pointer' }}>
                      <td style={{ padding: '10px 14px', color: '#888780', fontSize: 12 }}>{i + 1}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 500, color: '#2C2C2A' }}>{csr.name}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#444441' }}>{csr.completed}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#444441' }}>{csr.rescheduledByOthers}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#444441' }}>{csr.rescheduledFromOthers}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#444441' }}>{csr.totalLeads}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500, color: '#0052cc' }}>{csr.totalPoints.toFixed(1)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, background: csr.active ? '#EAF3DE' : '#FCEBEB', color: csr.active ? '#3B6D11' : '#A32D2D' }}>
                          {csr.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Manage CSRs Modal */}
      {showManageCSR && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 460, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>CSR employees</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowAddCSR(true)} style={{ padding: '6px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer' }}>+ Add CSR</button>
                <button onClick={() => { setShowManageCSR(false); setShowAddCSR(false); }} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer' }}>✕</button>
              </div>
            </div>
            {showAddCSR && (
              <div style={{ background: '#F1EFE8', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, color: '#444441' }}>Add a CSR</div>
                <div style={{ fontSize: 11, color: '#888780', marginBottom: 8 }}>Enter the CSR's full name exactly as it appears in FieldRoutes. All of their FR IDs are matched automatically — no need to enter IDs.</div>
                <input placeholder="Full name (e.g. Luis Cajas)" value={newCSRName} onChange={e => setNewCSRName(e.target.value)} style={{ width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '0.5px solid #D3D1C7', marginBottom: 8, boxSizing: 'border-box' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={async () => {
                    if (!newCSRName.trim()) return;
                    await fetch('/api/leads/csr-employees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCSRName.trim() }) });
                    setNewCSRName(''); setShowAddCSR(false); fetchCSREmployees();
                  }} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: 'none', background: '#0052cc', color: '#fff', cursor: 'pointer' }}>Save</button>
                  <button onClick={() => { setShowAddCSR(false); setNewCSRName(''); }} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer', color: '#888780' }}>Cancel</button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {csrEmployees.map(emp => (
                <div key={emp.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '0.5px solid #D3D1C7', borderRadius: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: emp.active ? '#2C2C2A' : '#888780' }}>{emp.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={async () => {
                      await fetch('/api/leads/csr-employees', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: emp.name, active: !emp.active }) });
                      fetchCSREmployees();
                    }} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: 'none', background: emp.active ? '#EAF3DE' : '#FCEBEB', color: emp.active ? '#3B6D11' : '#A32D2D', cursor: 'pointer' }}>
                      {emp.active ? 'Active' : 'Inactive'}
                    </button>
                    <button onClick={async () => {
                      if (!confirm(`Remove ${emp.name} from the CSR list? Their appointments still count in totals, but they won't show as a CSR row.`)) return;
                      await fetch('/api/leads/csr-employees', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: emp.name, isCsr: false }) });
                      fetchCSREmployees();
                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A32D2D', fontSize: 13, padding: 2 }} title="Remove from CSR list">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>Import Leads CSV</div>
              <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888780' }}>✕</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#888780', display: 'block', marginBottom: 4 }}>Office</label>
              <select value={importOffice} onChange={e => setImportOffice(e.target.value)} style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }}>
                {['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#888780', display: 'block', marginBottom: 4 }}>CSV / TSV File</label>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileChange} style={{ fontSize: 12, width: '100%' }} />
              {importRows.length > 0 && <div style={{ fontSize: 12, color: '#1D9E75', marginTop: 6 }}>✓ {importRows.length} rows ready to import</div>}
            </div>
            {importResult && (
              <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: importResult.error ? '#FCEBEB' : '#E1F5EE', fontSize: 12 }}>
                {importResult.error
                  ? <span style={{ color: '#A32D2D' }}>❌ {importResult.error}</span>
                  : <span style={{ color: '#0F6E56' }}>✓ Created: {importResult.created} | Updated: {importResult.updated} | Skipped: {importResult.skipped}</span>
                }
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowImport(false)} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleImport} disabled={importing || importRows.length === 0} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', background: importRows.length === 0 ? '#D3D1C7' : ACCENT, color: '#fff', cursor: importRows.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                {importing ? 'Importing...' : 'Import ' + importRows.length + ' rows'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSR Detail Drawer */}
      {drawerCSR && (
        <>
          {/* Backdrop */}
          <div onClick={() => { setDrawerCSR(null); setDrawerData(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 1000 }} />
          {/* Drawer */}
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 680, background: '#fff', zIndex: 1001, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ padding: '20px 24px', borderBottom: '0.5px solid #E8E7E3', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#2C2C2A' }}>{drawerCSR.name}</div>
                <div style={{ fontSize: 12, color: '#888780', marginTop: 2 }}>{drawerCSR.totalPoints.toFixed(1)} points · {drawerCSR.totalLeads} total leads</div>
              </div>
              <button onClick={() => { setDrawerCSR(null); setDrawerData(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#888780', padding: 4 }}>✕</button>
            </div>
            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {drawerLoading ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#888780' }}>Loading...</div>
              ) : drawerData && (
                <>
                  {/* Completed */}
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#2C2C2A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: '#EAF3DE', color: '#3B6D11', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>Completed</span>
                      <span style={{ color: '#888780', fontSize: 12 }}>{drawerData.completed.length} leads</span>
                    </div>
                    {drawerData.completed.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#888780' }}>None</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#F8F7F4' }}>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Date</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Customer</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Office</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Service type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drawerData.completed.map((r: any, i: number) => (
                            <tr key={i} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.date}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.customer}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.office}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.serviceType}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Rescheduled by others */}
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#2C2C2A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: '#FEF3E2', color: '#854F0B', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>Rescheduled by others</span>
                      <span style={{ color: '#888780', fontSize: 12 }}>{drawerData.rescheduledByOthers.length} leads</span>
                    </div>
                    {drawerData.rescheduledByOthers.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#888780' }}>None</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#F8F7F4' }}>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Date</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Customer</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Office</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Service type</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Rescheduled by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drawerData.rescheduledByOthers.map((r: any, i: number) => (
                            <tr key={i} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.date}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.customer}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.office}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.serviceType}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.rescheduledBy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Rescheduled from others */}
                  <div style={{ marginBottom: 28 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#2C2C2A', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ background: '#E6F1FB', color: '#185FA5', padding: '2px 8px', borderRadius: 6, fontSize: 12 }}>Rescheduled from others</span>
                      <span style={{ color: '#888780', fontSize: 12 }}>{drawerData.rescheduledFromOthers.length} leads</span>
                    </div>
                    {drawerData.rescheduledFromOthers.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#888780' }}>None</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#F8F7F4' }}>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Date</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Customer</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Office</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Service type</th>
                            <th style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>Originally booked by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {drawerData.rescheduledFromOthers.map((r: any, i: number) => (
                            <tr key={i} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.date}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.customer}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.office}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.serviceType}</td>
                              <td style={{ padding: '7px 10px', color: '#444441' }}>{r.originallyBookedBy}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* COMMISSIONS TAB */}
      {activeTab === 'commissions' && canCommissions && (
        <div style={{ marginTop: 16 }}>
          <CommissionsTab />
        </div>
      )}
    </div>
  );
}
