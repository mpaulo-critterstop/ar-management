'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const ACCENT = '#0052cc';
const OFFICES = ['All', 'DFW', 'ATX', 'OKC', 'CStat'];
const STATUSES = ['All', 'SOLD', 'INSPECTED', 'PENDING'];

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

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

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
      params.set('dateField', statusFilter === 'SOLD' ? 'sold' : 'inspection');
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

  // Pagination logic
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
      {/* Office switcher + Import button */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', paddingTop: 20 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
         <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 6, borderRadius: 14, background: '#f8fafc', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(15,23,42,0.06)' }}>
            {OFFICES.map(o => (
              <button key={o} onClick={() => setOffice(o)} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: office === o ? '#0f172a' : '#475569', background: office === o ? '#ffffff' : 'transparent', border: office === o ? '1px solid #dbe3ee' : '1px solid transparent', boxShadow: office === o ? '0 1px 3px rgba(15,23,42,0.08)' : 'none', cursor: 'pointer', transition: 'all 0.15s' }}>
                {o}
              </button>
            ))}
            <div style={{ width: '0.5px', background: '#e2e8f0', height: 20, margin: '0 2px' }} />
            <button onClick={() => router.push('/kpi')} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: '#0052cc', background: 'transparent', border: '1px solid transparent', cursor: 'pointer', transition: 'all 0.15s' }}>
              KPIs
            </button>
          </div>
        </div>
      <button
          onClick={async () => {
            if (syncing) return;
            setSyncing(true);
            fetch('/api/sync/appointments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'critterstop-cron-2024' },
              body: JSON.stringify({}),
            });
            setTimeout(async () => {
              await fetchLeads();
              setSyncing(false);
            }, 30000);
          }}
          disabled={syncing}
          style={{
            background: syncing ? '#e2e8f0' : ACCENT,
            color: syncing ? '#475569' : '#fff',
            border: 'none',
            padding: '9px 16px', borderRadius: 10,
            cursor: syncing ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap',
            boxShadow: syncing ? 'none' : '0 2px 10px rgba(15,23,42,0.12)',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          {syncing ? (
            <>
              <span style={{display:'inline-block',width:12,height:12,border:'2px solid #475569',borderTopColor:'transparent',borderRadius:'50%',animation:'spin 0.8s linear infinite'}} />
              Syncing...
            </>
          ) : '⟳ Sync FR'}
        </button>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

     {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Filters:</span>
          <input
            type="text"
            placeholder="Search customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', minWidth: 180 }}
          />
          <select value={statusInput} onChange={e => setStatusInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
            <option value="All">All</option>
            <option value="SOLD">Sold</option>
            <option value="INSPECTED">Inspected</option>
          </select>
          <select value={pmInput} onChange={e => setPmInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
            {pms.map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={fromInput} onChange={e => setFromInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
          <span style={{ fontSize: 12, color: '#888780' }}>to</span>
          <input type="date" value={toInput} onChange={e => setToInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
          <button
            onClick={() => { setFrom(fromInput); setTo(toInput); setStatusFilter(statusInput); setPmFilter(pmInput); }}
            style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', fontWeight: 500 }}
          >
            Apply
          </button>
          {(from || to || statusFilter !== 'All' || pmFilter !== 'All') && (
            <button
              onClick={() => { setFrom(''); setTo(''); setFromInput(''); setToInput(''); setStatusFilter('All'); setStatusInput('All'); setPmFilter('All'); setPmInput('All'); }}
              style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
        </div>
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
              <div style={{ fontSize: 22, fontWeight: 500, color: (card as any).color || '#2C2C2A' }}>{loading ? '...' : card.value}</div>
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
              ) : displayed.map((lead: any) => (
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
              ))}
              {!loading && leads.length === 0 && (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>No leads found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '0.5px solid #E8E7E3', background: '#F8F7F4', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#888780' }}>
            Showing {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} leads
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} style={{ fontSize: 12, padding: '2px 6px', border: '0.5px solid #B4B2A9', borderRadius: 4 }}>
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
      
      {/* Import Modal */}
      {showImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>Import Leads CSV</div>
              <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888780' }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: '#888780', marginBottom: 12, background: '#F8F7F4', padding: 10, borderRadius: 8 }}>
              Expected columns:<br/>
              <strong>Inspection Date | Customer Name | FR ID | PM | Invoice ID | Sold? | Amount Booked | Date Sold</strong>
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
              {importRows.length > 0 && (
                <div style={{ fontSize: 12, color: '#1D9E75', marginTop: 6 }}>✓ {importRows.length} rows ready to import</div>
              )}
            </div>
            {importResult && (
              <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: importResult.error ? '#FCEBEB' : '#E1F5EE', fontSize: 12 }}>
                {importResult.error
                  ? <span style={{ color: '#A32D2D' }}>❌ {importResult.error}</span>
                  : <span style={{ color: '#0F6E56' }}>✓ Created: {importResult.created} | Updated: {importResult.updated} | Skipped: {importResult.skipped} | Errors: {importResult.errors}</span>
                }
                {importResult.skipReasons?.length > 0 && (
                  <div style={{ marginTop: 6, color: '#888780' }}>
                    {importResult.skipReasons.slice(0, 5).map((r: string, i: number) => <div key={i}>• {r}</div>)}
                  </div>
                )}
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
    </div>
  );
}
