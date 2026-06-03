'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const ACCENT = '#92c1e9';
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
  const [loading, setLoading] = useState(true);

  const [office, setOffice] = useState('DFW');
  const [statusFilter, setStatusFilter] = useState('All');
  const [pmFilter, setPmFilter] = useState('All');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');

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
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('dateField', dateField);
    const res = await fetch(`/api/leads?${params}`);
    const data = await res.json();
    setLeads(data.leads || []);
    setKpis(data.kpis || null);
    setPmKpis(data.pmKpis || []);
    setCurrentPage(1);
    setLoading(false);
  }, [office, statusFilter, pmFilter, from, to]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const pms = ['All', ...Array.from(new Set(leads.map((l: any) => l.pmName).filter(Boolean)))];

  // Pagination logic
  const totalPages = Math.ceil(leads.length / pageSize);
  const displayed = leads.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
    <div style={{ padding: '0 24px 24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Office switcher + Import button */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between', paddingTop: 20 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Office:</span>
          {OFFICES.map(o => (
            <button key={o} onClick={() => setOffice(o)} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 20, border: '0.5px solid ' + (office === o ? ACCENT : '#D3D1C7'), background: office === o ? ACCENT : '#fff', color: office === o ? '#fff' : '#888780', cursor: 'pointer', fontWeight: office === o ? 500 : 400 }}>
              {o}
            </button>
          ))}
        </div>
        <button onClick={() => { setShowImport(true); setImportResult(null); setImportRows([]); setImporting(false); }} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: '0.5px solid ' + ACCENT, background: ACCENT, color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
          ↑ Import CSV
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#888780' }}>Filters:</span>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          {STATUSES.map(s => <option key={s}>{s}</option>)}
        </select>
        <select value={pmFilter} onChange={e => setPmFilter(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          {pms.map(p => <option key={p}>{p}</option>)}
        </select>
        <select value={dateField} onChange={e => setDateField(e.target.value as 'inspection' | 'sold')} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff' }}>
          <option value="inspection">Inspection date</option>
          <option value="sold">Sold date</option>
        </select>
        <input type="date" value={fromInput} onChange={e => setFromInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        <span style={{ fontSize: 12, color: '#888780' }}>to</span>
        <input type="date" value={toInput} onChange={e => setToInput(e.target.value)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: '0.5px solid #D3D1C7' }} />
        <button
          onClick={() => { setFrom(fromInput); setTo(toInput); }}
          style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', cursor: 'pointer', fontWeight: 500 }}
        >
          Apply
        </button>
        {(from || to) && (
          <button
            onClick={() => { setFrom(''); setTo(''); setFromInput(''); setToInput(''); }}
            style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: '0.5px solid #D3D1C7', background: '#fff', color: '#888780', cursor: 'pointer' }}
          >
            Clear
          </button>
        )}
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
            Showing {leads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, leads.length)} of {leads.length} leads &nbsp;
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

      {/* PM KPIs table */}
      <div style={{ marginBottom: 8, fontWeight: 500, fontSize: 14 }}>KPIs by PM</div>
      <div style={{ background: '#fff', borderRadius: 12, border: '0.5px solid #E8E7E3', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#F8F7F4' }}>
              {['PM', 'Total leads', 'Sold', 'Close %', 'Avg sale', 'Booked revenue'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>Loading...</td></tr>
            ) : pmKpis.map((pm: any) => (
              <tr key={pm.pmName} style={{ borderBottom: '0.5px solid #F1EFE8' }}>
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
                {importing ? 'Importing...' : `Import ${importRows.length} rows`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
