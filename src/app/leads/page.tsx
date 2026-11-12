'use client';
import BackButton from '@/components/BackButton';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CommissionsTab } from './CommissionsTab';
import { KpiTab } from './KpiTab';
import { LastSynced } from '@/components/LastSynced';
import { canAccessModule, perm } from '@/lib/access';
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip } from '@/components/cc/Layout';

const ACCENT = '#5B9BE0';
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
  const [activeTab, setActiveTab] = useState<'leads' | 'commissions' | 'kpi'>('leads');

  // Honor ?tab= for deep links.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'commissions' || t === 'leads' || t === 'kpi') setActiveTab(t as any);
  }, []);

  // Access: full leads module unlocks Leads/KPIs/Commissions.
  const sUser = session?.user as any;
  const canLeads = canAccessModule(sUser, 'leads');
  const canKpis = canLeads && !perm(sUser, 'hidePmKpis');
  const canCommissions = canLeads && !perm(sUser, 'hideCommissions');

  // If the user can't see the current tab, move them to one they can.
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (activeTab === 'leads' && !canLeads) setActiveTab('commissions');
    if (activeTab === 'commissions' && !canCommissions) setActiveTab('leads');
    if (activeTab === 'kpi' && !canKpis) setActiveTab('leads');
  }, [status, activeTab, canLeads, canCommissions, canKpis]);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importOffice, setImportOffice] = useState('DFW');
  const [importRows, setImportRows] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated' && !canLeads) {
      // No leads access — send CSR-only users to their page, others home.
      router.replace(canAccessModule(sUser, 'csr') ? '/csr' : '/');
    }
  }, [status, router, canLeads, sUser]);

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
    <div style={{ padding: '30px 34px 70px', maxWidth: 1400, margin: '0 auto' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <CCPageHeader icon="🎯" title="Leads Tracker" subtitle="Wildlife inspection leads, PM performance, conversion and commissions"
        actions={<LastSynced office={office} />} />

      {/* Nav: office pills + tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        {canLeads && <div style={{ display: 'inline-flex', gap: 6 }}>
          {OFFICES.map(o => { const on = activeTab==='leads' && office===o; return (
            <button key={o} onClick={() => { setOffice(o); setActiveTab('leads'); }} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on?'#5B9BE0':'#2A2A30'}`, background: on?'#15263a':'#1C1C21', color: on?'#5B9BE0':'#908E85' }}>{o}</button>
          );})}
        </div>}
        <div style={{ display: 'inline-flex', gap: 6 }}>
          {canKpis && (()=>{ const on=activeTab==='kpi'; return (
            <button onClick={() => setActiveTab('kpi')} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on?'#5B9BE0':'#2A2A30'}`, background: on?'#15263a':'#1C1C21', color: on?'#5B9BE0':'#908E85' }}>KPIs</button>
          );})()}
          {canCommissions && (()=>{ const on=activeTab==='commissions'; return (
            <button onClick={() => setActiveTab('commissions')} style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on?'#5B9BE0':'#2A2A30'}`, background: on?'#15263a':'#1C1C21', color: on?'#5B9BE0':'#908E85' }}>Commissions</button>
          );})()}
        </div>
      </div>

      {/* LEADS TAB */}
      {activeTab === 'leads' && canLeads && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#908E85' }}>Filters:</span>
              <input type="text" placeholder="Search customer..." value={search} onChange={e => setSearch(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #2A2A30', minWidth: 180 }} />
              <select value={statusInput} onChange={e => setStatusInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21' }}>
                <option value="All">All</option>
                <option value="SOLD">Sold</option>
              </select>
              <select value={pmInput} onChange={e => setPmInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21' }}>
                {pms.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={fromInput} onChange={e => setFromInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #2A2A30' }} />
              <span style={{ fontSize: 12, color: '#908E85' }}>to</span>
              <input type="date" value={toInput} onChange={e => setToInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #2A2A30' }} />
              <button onClick={() => { setFrom(fromInput); setTo(toInput); setStatusFilter(statusInput); setPmFilter(pmInput); }} style={{ padding: '7px 14px', fontSize: 13, borderRadius: 9, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#F0EEE8', cursor: 'pointer', fontWeight: 500 }}>Apply</button>
              {(from || to || statusFilter !== 'All' || pmFilter !== 'All') && (
                <button onClick={() => { setFrom(''); setTo(''); setFromInput(''); setToInput(''); setStatusFilter('All'); setStatusInput('All'); setPmFilter('All'); setPmInput('All'); }} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', color: '#908E85', cursor: 'pointer' }}>Clear</button>
              )}
            </div>
          </div>

          {/* KPI strip */}
          {kpis && (
            <CCKpiStrip items={[
              { icon:'🎯', label:'Total leads', value: loading?'…':kpis.total, tone:'blue', delta:'all inspections' },
              { icon:'✅', label:'Sold', value: loading?'…':kpis.sold, tone:'green', delta:`+${kpis.inspected} inspected`, deltaTone:'green' },
              { icon:'📈', label:'Conversion rate', value: loading?'…':pct(kpis.conversionRate), tone:'amber', delta:'sold / total' },
              { icon:'💵', label:'Booked revenue', value: loading?'…':fmt((kpis.bookedRevenue||0)+(kpis.upsellRevenue||0)), tone:'green', delta:`avg ${fmt(kpis.avgSale)}`, deltaTone:'green' },
            ]} />
          )}

          {/* Lead records table */}
          <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14 }}>Lead records</div>
          <div style={{ background: '#1C1C21', borderRadius: 12, border: '0.5px solid #2A2A30', overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                  <tr style={{ background: '#232329' }}>
                    {['Customer', 'Inspection Date', 'Sold Date', 'PM', 'Status', 'Invoice', 'Amount', 'Office'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#908E85', borderBottom: '0.5px solid #2A2A30' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#908E85' }}>Loading...</td></tr>
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
                      <tr key={lead.id} style={{ borderBottom: '0.5px solid #232329' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>{lead.customer?.name || '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.inspectionDate ? lead.inspectionDate.split('T')[0] : '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.invoice?.date ? lead.invoice.date.split('T')[0] : '—'}</td>
                        <td style={{ padding: '10px 12px' }}>{lead.pmName || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: lead.status === 'SOLD' ? '#143229' : lead.status === 'INSPECTED' ? '#E6F1FB' : '#FAEEDA', color: lead.status === 'SOLD' ? '#43B892' : lead.status === 'INSPECTED' ? '#185FA5' : '#854F0B' }}>
                            {lead.status}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.invoice?.externalId || '—'}</td>
                        <td style={{ padding: '10px 12px' }}>{lead.amount ? fmt(lead.amount) : '—'}</td>
                        <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.office}</td>
                      </tr>
                      );
                    }
                    if (lead.upsellAmount && lead.upsellDate) {
                      const upsellDateStr = lead.upsellDate.split('T')[0];
                      const upsellInRange = noDateFilter ||
                        ((!fromDate || upsellDateStr >= fromDate) && (!toDate || upsellDateStr <= toDate));
                      if (upsellInRange) {
                        rows.push(
                        <tr key={lead.id + '_upsell'} style={{ borderBottom: '0.5px solid #232329', background: '#232329' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 500 }}>{lead.customer?.name || '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.inspectionDate ? lead.inspectionDate.split('T')[0] : '—'}</td>
                          <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.upsellDate.split('T')[0]}</td>
                          <td style={{ padding: '10px 12px' }}>{lead.pmName || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: '#F0EAFD', color: '#6B3FA0' }}>
                              Upsell
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.upsellInvoice?.externalId || '—'}</td>
                          <td style={{ padding: '10px 12px' }}>{fmt(lead.upsellAmount)}</td>
                          <td style={{ padding: '10px 12px', color: '#908E85' }}>{lead.office}</td>
                        </tr>
                      );
                      }
                    }
                    return rows;
                  })}
                  {!loading && leads.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#908E85' }}>No leads found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '0.5px solid #2A2A30', background: '#232329', flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 12, color: '#908E85' }}>
                Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} leads
                <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} style={{ fontSize: 12, padding: '2px 6px', border: '0.5px solid #63615A', borderRadius: 4, marginLeft: 6 }}>
                  <option value={100}>100</option>
                  <option value={500}>500</option>
                  <option value={1000}>1000</option>
                </select> per page
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #2A2A30', borderRadius: 4, background: currentPage === 1 ? '#232329' : '#1C1C21', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>Previous</button>
                {pageNums().map((p, i) => p === -1
                  ? <span key={i} style={{ padding: '3px 6px', fontSize: 12 }}>…</span>
                  : <button key={p} onClick={() => setCurrentPage(p)} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #2A2A30', borderRadius: 4, background: currentPage === p ? ACCENT : '#1C1C21', color: currentPage === p ? '#1C1C21' : '#F0EEE8', cursor: 'pointer' }}>{p}</button>
                )}
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={{ padding: '3px 10px', fontSize: 12, border: '0.5px solid #2A2A30', borderRadius: 4, background: currentPage === totalPages ? '#232329' : '#1C1C21', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>Next</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Import Modal */}
      {showImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#1C1C21', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>Import Leads CSV</div>
              <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#908E85' }}>✕</button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#908E85', display: 'block', marginBottom: 4 }}>Office</label>
              <select value={importOffice} onChange={e => setImportOffice(e.target.value)} style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #2A2A30' }}>
                {['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#908E85', display: 'block', marginBottom: 4 }}>CSV / TSV File</label>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileChange} style={{ fontSize: 12, width: '100%' }} />
              {importRows.length > 0 && <div style={{ fontSize: 12, color: '#43B892', marginTop: 6 }}>✓ {importRows.length} rows ready to import</div>}
            </div>
            {importResult && (
              <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: importResult.error ? '#FCEBEB' : '#143229', fontSize: 12 }}>
                {importResult.error
                  ? <span style={{ color: '#A32D2D' }}>❌ {importResult.error}</span>
                  : <span style={{ color: '#43B892' }}>✓ Created: {importResult.created} | Updated: {importResult.updated} | Skipped: {importResult.skipped}</span>
                }
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowImport(false)} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '0.5px solid #2A2A30', background: '#1C1C21', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleImport} disabled={importing || importRows.length === 0} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', background: importRows.length === 0 ? '#2A2A30' : ACCENT, color: '#1C1C21', cursor: importRows.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                {importing ? 'Importing...' : 'Import ' + importRows.length + ' rows'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMMISSIONS TAB */}
      {activeTab === 'commissions' && canCommissions && (
        <div style={{ marginTop: 16 }}>
          <CommissionsTab />
        </div>
      )}

      {/* KPI TAB */}
      {activeTab === 'kpi' && canKpis && (
        <div style={{ marginTop: 16 }}>
          <KpiTab />
        </div>
      )}
    </div>
  );
}
