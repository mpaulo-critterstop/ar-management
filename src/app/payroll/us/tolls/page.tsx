'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

const money = (n: number) => '$' + Math.abs(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Minimal CSV/row parser: expects the toll Transaction History (headers incl. Plate + Transaction Amount +
// Transaction Entry Date/Time). We find those columns by header name.
function parseCsv(text: string): { plate: string; amount: string; date: string }[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => {
    const out: string[] = []; let cur = '', q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map(s => s.trim());
  };
  const header = split(lines[0]).map(h => h.toLowerCase());
  const plateIdx = header.findIndex(h => h.includes('plate'));
  const amtIdx = header.findIndex(h => h.includes('transaction amount') || h === 'amount');
  const dateIdx = header.findIndex(h => h.includes('entry date'));
  if (plateIdx < 0 || amtIdx < 0) return [];
  return lines.slice(1).map(l => { const c = split(l); return { plate: c[plateIdx] || '', amount: c[amtIdx] || '', date: dateIdx >= 0 ? (c[dateIdx] || '') : '' }; }).filter(r => r.plate || r.amount);
}

export default function TollsPage() {
  const [result, setResult] = useState<any>(null);
  const [computing, setComputing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'calc' | 'registry'>('calc');
  const [plates, setPlates] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null); // the plate being edited, or {} for a new one
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const loadPlates = () => fetch('/api/payroll/tolls?action=plates').then(r => r.json()).then(d => setPlates(d.plates || [])).catch(() => {});
  useEffect(() => { loadPlates(); }, []);

  async function savePlate() {
    if (!editing?.plateRaw || !editing?.tech) { alert('Plate and Technician are required.'); return; }
    setSaving(true);
    await fetch('/api/payroll/tolls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: editing.id ? 'updatePlate' : 'addPlate', id: editing.id, plateRaw: editing.plateRaw, tech: editing.tech, vehicle: editing.vehicle, tollTag: editing.tollTag, active: editing.active !== false }),
    });
    setSaving(false); setEditing(null); loadPlates();
  }
  async function deletePlate(id: string, plate: string) {
    if (!confirm(`Delete plate ${plate} from the registry?`)) return;
    await fetch('/api/payroll/tolls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deletePlate', id }) });
    loadPlates();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name); setErr(''); setResult(null); setComputing(true);
    try {
      let rows: any[] = [];
      if (f.name.toLowerCase().endsWith('.csv')) {
        rows = parseCsv(await f.text());
      } else if (/\.xlsx?$/i.test(f.name)) {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
        if (aoa.length > 1) {
          const header = (aoa[0] || []).map((h: any) => String(h).toLowerCase());
          const plateIdx = header.findIndex((h: string) => h.includes('plate'));
          const amtIdx = header.findIndex((h: string) => h.includes('transaction amount') || h === 'amount');
          const dateIdx = header.findIndex((h: string) => h.includes('entry date'));
          if (plateIdx >= 0 && amtIdx >= 0) {
            rows = aoa.slice(1).map(c => ({ plate: c[plateIdx] || '', amount: c[amtIdx] || '', date: dateIdx >= 0 ? (c[dateIdx] || '') : '' })).filter(r => r.plate || r.amount);
          }
        }
      } else {
        setErr('Please upload a .xlsx or .csv toll Transaction History file.'); setComputing(false); return;
      }
      if (!rows.length) { setErr('Could not find Plate / Transaction Amount columns in the file. Check the headers.'); setComputing(false); return; }
      const res = await fetch('/api/payroll/tolls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'compute', rows }) });
      const d = await res.json();
      setResult(d);
    } catch (e: any) { setErr('Failed to process the file.'); }
    setComputing(false);
  }

  const th: React.CSSProperties = { textAlign: 'right', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3' };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/payroll/us" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← US Payroll</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>Tolls</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 20px' }}>Upload the toll Transaction History CSV; tolls are matched to each tech by license plate.</p>

      <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 20 }}>
        {(['calc', 'registry'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#2C2C2A' : '#888780', fontWeight: tab === t ? 600 : 400 }}>{t === 'calc' ? 'Calculate' : `Plate Registry (${plates.length})`}</button>
        ))}
      </div>

      {tab === 'calc' && (<>
        <label style={{ display: 'inline-block', fontSize: 13, padding: '10px 18px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: 'pointer' }}>
          ⤒ Upload toll file (.xlsx or .csv)
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: 'none' }} />
        </label>
        {fileName && <span style={{ fontSize: 12, color: '#888780', marginLeft: 12 }}>{fileName}</span>}
        {computing && <div style={{ fontSize: 13, color: '#888780', marginTop: 12 }}>Processing…</div>}
        {err && <div style={{ fontSize: 13, color: '#b91c1c', background: '#FCEBEB', border: '0.5px solid #F7C1C1', borderRadius: 8, padding: '10px 14px', marginTop: 14 }}>{err}</div>}

        {result && (<>
          <div style={{ display: 'flex', gap: 12, margin: '18px 0', flexWrap: 'wrap' }}>
            {[
              { label: 'Total tolls', value: money(result.total) },
              { label: 'Matched', value: result.matched },
              { label: 'Unmatched', value: result.unmatched, warn: result.unmatched > 0 },
              { label: 'Period', value: result.periodStart ? `${result.periodStart} → ${result.periodEnd}` : '—' },
            ].map(s => (
              <div key={s.label} style={{ border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '10px 16px', minWidth: 110, background: '#fff' }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: (s as any).warn ? '#b91c1c' : '#2C2C2A' }}>{s.value}</div>
                <div style={{ fontSize: 11, color: '#888780' }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thL}>Technician</th><th style={th}># Tolls</th><th style={th}>Toll Total</th></tr></thead>
              <tbody>
                {(result.perTech || []).map((t: any) => (
                  <tr key={t.tech}><td style={tdL}>{t.tech}</td><td style={td}>{t.count}</td><td style={{ ...td, fontWeight: 600 }}>{money(t.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.unmatchedList?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#b91c1c', marginBottom: 8 }}>⚠ Unmatched plates — add these to the registry</div>
              <div style={{ border: '0.5px solid #F7C1C1', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thL}>Plate</th><th style={th}># Tolls</th><th style={th}>Amount</th></tr></thead>
                  <tbody>{result.unmatchedList.map((u: any) => (<tr key={u.plate}><td style={tdL}>{u.plate}</td><td style={td}>{u.count}</td><td style={td}>{money(u.amount)}</td></tr>))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>)}
      </>)}

      {tab === 'registry' && (<>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <button onClick={() => setEditing({ active: true })} style={{ fontSize: 13, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: 'pointer' }}>+ Add plate / vehicle</button>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search plate or tech…" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E8E7E3', flex: 1, minWidth: 180 }} />
        </div>

        {editing && (
          <div style={{ border: '0.5px solid #534AB7', borderRadius: 12, padding: 16, background: '#F7F6FD', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{editing.id ? 'Edit' : 'Add'} plate</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label style={{ fontSize: 12, color: '#888780' }}>License plate *<input value={editing.plateRaw || ''} onChange={e => setEditing({ ...editing, plateRaw: e.target.value })} placeholder="TX - RRX4740" style={{ display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: '#888780' }}>Technician *<input value={editing.tech || ''} onChange={e => setEditing({ ...editing, tech: e.target.value })} placeholder="Jared Brown" style={{ display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: '#888780' }}>Vehicle<input value={editing.vehicle || ''} onChange={e => setEditing({ ...editing, vehicle: e.target.value })} placeholder="2022 Toyt Tacoma" style={{ display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', marginTop: 4 }} /></label>
              <label style={{ fontSize: 12, color: '#888780' }}>Toll tag<input value={editing.tollTag || ''} onChange={e => setEditing({ ...editing, tollTag: e.target.value })} placeholder="DFW.05297640" style={{ display: 'block', width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', marginTop: 4 }} /></label>
            </div>
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 12, color: '#888780', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={editing.active !== false} onChange={e => setEditing({ ...editing, active: e.target.checked })} /> Active (inactive plates are ignored in toll matching)</label>
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button onClick={savePlate} disabled={saving} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontWeight: 500, cursor: saving ? 'wait' : 'pointer' }}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => setEditing(null)} style={{ fontSize: 13, padding: '8px 18px', borderRadius: 8, border: '0.5px solid #E8E7E3', background: '#fff', color: '#888780', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thL}>Plate</th><th style={thL}>Technician</th><th style={thL}>Vehicle</th><th style={thL}>Toll Tag</th><th style={th}></th></tr></thead>
            <tbody>
              {plates.filter(p => !search || (p.plateRaw + ' ' + p.tech).toLowerCase().includes(search.toLowerCase())).map(p => (
                <tr key={p.id} style={{ opacity: p.active === false ? 0.5 : 1 }}>
                  <td style={tdL}>{p.plateRaw}{p.active === false && <span style={{ fontSize: 10, color: '#888780', marginLeft: 6 }}>(inactive)</span>}</td>
                  <td style={tdL}>{p.tech}</td>
                  <td style={tdL}>{p.vehicle || '—'}</td>
                  <td style={tdL}>{p.tollTag || '—'}</td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => setEditing({ ...p })} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#534AB7', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                    <button onClick={() => deletePlate(p.id, p.plateRaw)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E8E7E3', background: '#fff', color: '#b91c1c', cursor: 'pointer' }}>Delete</button>
                  </td>
                </tr>
              ))}
              {!plates.length && <tr><td colSpan={5} style={{ ...tdL, color: '#888780', padding: 20 }}>No plates in the registry yet. Add one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </>)}
    </div>
  );
}
