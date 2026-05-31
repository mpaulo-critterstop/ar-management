'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from 'react';
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

function parseCSV(text: string): any[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
  return lines.slice(1).map(line => {
    const values = line.split(delimiter);
    const row: any = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    // Map Excel column names to our format
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

    const res = await fetch(`/api/leads?${params}`);
    const data = await res.json();
    setLeads(data.leads || []);
    setKpis(data.kpis || null);
    setPmKpis(data.pmKpis || []);
    setLoading(false);
  }, [office, statusFilter, pmFilter, from, to]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const pms = ['All', ...Array.from(new Set(leads.map((l: any) => l.pmName).filter(Boolean)))];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setImportRows(rows);
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
    } catch (err) {
      setImportResult({ error: 'Import failed' });
    }
    setImporting(false);
  };

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
            <a key={tab.href} href={tab.href} style={{ padding: '14px 16px', fontSize: 13, fontWeight: tab.active ? 500 : 400, color: tab.active ? '#1D9E75' : '#888780', borderBottom: tab.active ? '2px solid #1D9E75' : '2px solid transparent', textDecoration: 'none' }}>
              {tab.label}
            </a>
          ))}
        </div>
        <div style={{ fontSize: 13, color: '#888780' }}>{session?.user?.email}</div>
      </div>

      <div style={{ padding: 20 }}>
        {/* Office switcher + Import button */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#888780' }}>Office:</span>
            {OFFICES.map(o => (
              <button key={o} onClick={() => setOffice(o)} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 20, border: '1px solid ' + (office === o ? '#1D9E75' : '#D3D1C7'), background: office === o ? '#1D9E75' : '#fff', color: office === o ? '#fff' : '#888780', cursor: 'pointer', fontWeight: office === o ? 500 : 400 }}>
                {o}
              </button>
            ))}
          </div>
          <button onClick={() => { setShowImport(true); setImportResult(null); setImportRows([]); setImporting(false); }} style={{ padding: '6px 14px', fontSize: 12, borderRadius: 8, border: '1px solid #1D9E75', background: '#1D9E75', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
            ↑ Import CSV
          </button>
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
                {['Customer', 'Inspection Date', 'Sold Date', 'PM', 'Status', 'Invoice', 'Amount', 'Office'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '1px solid #E8E7E3' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>Loading...</td></tr>
              ) : leads.slice(0, 100).map((lead: any) => (
                <tr key={lead.id} style={{ borderBottom: '1px solid #F1EFE8' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{lead.customer?.name || '—'}</td>
                  <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.inspectionDate ? new Date(lead.inspectionDate).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '10px 12px', color: '#888780' }}>{lead.invoice?.date ? new Date(lead.invoice.date).toLocaleDateString() : '—'}</td>
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
                <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#888780' }}>No leads found</td></tr>
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

      {/* Import Modal */}
      {showImport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 480, maxWidth: '90vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 500, fontSize: 15 }}>Import Leads CSV</div>
              <button onClick={() => setShowImport(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#888780' }}>✕</button>
            </div>

            <div style={{ fontSize: 12, color: '#888780', marginBottom: 12, background: '#F8F7F4', padding: 10, borderRadius: 8 }}>
              Expected columns (tab-separated):<br/>
              <strong>Inspection Date | Customer Name | FR ID | PM | Invoice ID | Sold? | Amount Booked | Date Sold</strong>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#888780', display: 'block', marginBottom: 4 }}>Office</label>
              <select value={importOffice} onChange={e => setImportOffice(e.target.value)} style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid #D3D1C7' }}>
                {['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#888780', display: 'block', marginBottom: 4 }}>CSV / TSV File</label>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileChange} style={{ fontSize: 12, width: '100%' }} />
              {importRows.length > 0 && (
                <div style={{ fontSize: 12, color: '#1D9E75', marginTop: 6 }}>
                  ✓ {importRows.length} rows ready to import
                </div>
              )}
            </div>

            {importResult && (
              <div style={{ marginBottom: 16, padding: 10, borderRadius: 8, background: importResult.error ? '#FCEBEB' : '#E1F5EE', fontSize: 12 }}>
                {importResult.error ? (
                  <span style={{ color: '#A32D2D' }}>❌ {importResult.error}</span>
                ) : (
                  <span style={{ color: '#0F6E56' }}>
                    ✓ Created: {importResult.created} | Updated: {importResult.updated} | Skipped: {importResult.skipped} | Errors: {importResult.errors}
                  </span>
                )}
                {importResult.skipReasons?.length > 0 && (
                  <div style={{ marginTop: 6, color: '#888780' }}>
                    {importResult.skipReasons.slice(0, 5).map((r: string, i: number) => <div key={i}>• {r}</div>)}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowImport(false)} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: '1px solid #D3D1C7', background: '#fff', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleImport} disabled={importing || importRows.length === 0} style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, border: 'none', background: importRows.length === 0 ? '#D3D1C7' : '#1D9E75', color: '#fff', cursor: importRows.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 500 }}>
                {importing ? 'Importing...' : `Import ${importRows.length} rows`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
