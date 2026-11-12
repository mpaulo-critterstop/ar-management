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
import { PageHeader as CCPageHeader, KpiStrip as CCKpiStrip, DataTable as CCDataTable, Toolbar as CCToolbar, SearchBox as CCSearchBox, CustomerCell as CCCustomerCell } from '@/components/cc/Layout';
import { Btn as CCBtn, StatusPill as CCStatusPill, SectionHeader as CCSectionHeader } from '@/components/cc/Primitives';

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

  const selStyle: React.CSSProperties = { fontSize: 12.5, padding: '8px 11px', borderRadius: 9, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8' };

  // Flatten leads into display rows (primary + optional upsell), honoring the date filter — for the cc DataTable.
  const leadRows = displayed.flatMap((lead: any) => {
    const out: any[] = [];
    const invoiceDate = lead.invoice?.date ? lead.invoice.date.split('T')[0] : null;
    const fromDate = from || null, toDate = to || null;
    const noDateFilter = !fromDate && !toDate;
    const primaryInRange = noDateFilter || statusFilter !== 'SOLD' || lead.status !== 'SOLD' ||
      (invoiceDate !== null && (!fromDate || invoiceDate >= fromDate) && (!toDate || invoiceDate <= toDate));
    if (primaryInRange) out.push({ ...lead, _rowKey: lead.id, _isUpsell: false, _dateStr: lead.invoice?.date ? lead.invoice.date.split('T')[0] : null, _invExt: lead.invoice?.externalId, _amt: lead.amount });
    if (lead.upsellAmount && lead.upsellDate) {
      const u = lead.upsellDate.split('T')[0];
      if (noDateFilter || ((!fromDate || u >= fromDate) && (!toDate || u <= toDate)))
        out.push({ ...lead, _rowKey: lead.id + '_upsell', _isUpsell: true, _dateStr: u, _invExt: lead.upsellInvoice?.externalId, _amt: lead.upsellAmount });
    }
    return out;
  });

  const Pagination2 = () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 4px', flexWrap: 'wrap', gap: 8 }}>
      <div style={{ fontSize: 12, color: '#908E85' }}>
        Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} style={{ ...selStyle, padding: '3px 7px', marginLeft: 6 }}>
          <option value={100}>100</option><option value={500}>500</option><option value={1000}>1000</option>
        </select> per page
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <CCBtn variant="secondary" style={{ padding: '5px 11px', fontSize: 12 }} disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>Prev</CCBtn>
        <span style={{ fontSize: 12, color: '#908E85' }}>{currentPage} / {totalPages || 1}</span>
        <CCBtn variant="secondary" style={{ padding: '5px 11px', fontSize: 12 }} disabled={currentPage === totalPages || totalPages === 0} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>Next</CCBtn>
      </div>
    </div>
  );

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
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: '#121216', paddingTop: 2, margin: '0 -34px', padding: '2px 34px 6px' }}>
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
      </div>

      {/* LEADS TAB */}
      {activeTab === 'leads' && canLeads && (
        <>
          {/* Filters */}
          <CCToolbar>
            <select value={statusInput} onChange={e => setStatusInput(e.target.value)} style={selStyle}>
              <option value="All">All statuses</option><option value="SOLD">Sold</option>
            </select>
            <select value={pmInput} onChange={e => setPmInput(e.target.value)} style={selStyle}>
              {pms.map(p => <option key={p}>{p}</option>)}
            </select>
            <input type="date" value={fromInput} onChange={e => setFromInput(e.target.value)} style={selStyle} />
            <span style={{ fontSize: 12, color: '#908E85' }}>to</span>
            <input type="date" value={toInput} onChange={e => setToInput(e.target.value)} style={selStyle} />
            <CCBtn variant="secondary" onClick={() => { setFrom(fromInput); setTo(toInput); setStatusFilter(statusInput); setPmFilter(pmInput); }}>Apply</CCBtn>
            {(from || to || statusFilter !== 'All' || pmFilter !== 'All') && (
              <CCBtn variant="ghost" onClick={() => { setFrom(''); setTo(''); setFromInput(''); setToInput(''); setStatusFilter('All'); setStatusInput('All'); setPmFilter('All'); setPmInput('All'); }}>Clear</CCBtn>
            )}
            <CCSearchBox value={search} onChange={setSearch} placeholder="Search customer…" />
          </CCToolbar>

          <CCSectionHeader note={`${filtered.length} leads`}>Lead records</CCSectionHeader>
          <CCDataTable
            rowKey={(r:any)=>r._rowKey}
            empty={loading ? 'Loading…' : 'No leads found'}
            cols={[
              { key:'cust', label:'Customer', render:(r:any)=><CCCustomerCell name={r.customer?.name || '—'} /> },
              { key:'insp', label:'Inspection', render:(r:any)=><span style={{color:'#908E85',fontSize:12.5}}>{r.inspectionDate ? r.inspectionDate.split('T')[0] : '—'}</span> },
              { key:'sold', label:'Sold / Upsell date', render:(r:any)=><span style={{color:'#908E85',fontSize:12.5}}>{r._dateStr || '—'}</span> },
              { key:'pm', label:'PM', render:(r:any)=><span style={{color:'#C9C7BF'}}>{r.pmName || '—'}</span> },
              { key:'status', label:'Status', render:(r:any)=><CCStatusPill tone={r._isUpsell?'violet':r.status==='SOLD'?'green':r.status==='INSPECTED'?'blue':'amber'}>{r._isUpsell?'Upsell':r.status}</CCStatusPill> },
              { key:'inv', label:'Invoice', render:(r:any)=><span style={{fontVariantNumeric:'tabular-nums',color:'#908E85'}}>{r._invExt || '—'}</span> },
              { key:'amt', label:'Amount', align:'right', render:(r:any)=><span style={{fontWeight:700,color:'#F0EEE8',fontVariantNumeric:'tabular-nums'}}>{r._amt ? fmt(r._amt) : '—'}</span> },
              { key:'office', label:'Office', render:(r:any)=> r.office ? <CCStatusPill tone="blue">{r.office}</CCStatusPill> : '—' },
            ]}
            rows={leadRows}
          />
          <Pagination2 />

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
                  ? <span style={{ color: '#E57C7C' }}>❌ {importResult.error}</span>
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
