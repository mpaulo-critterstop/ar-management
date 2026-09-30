'use client';
export const dynamic = 'force-dynamic';
import { useState, useEffect } from 'react';

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

  useEffect(() => { fetch('/api/payroll/tolls?action=plates').then(r => r.json()).then(d => setPlates(d.plates || [])).catch(() => {}); }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setFileName(f.name); setErr(''); setResult(null); setComputing(true);
    try {
      let rows: any[] = [];
      if (f.name.endsWith('.csv')) {
        rows = parseCsv(await f.text());
      } else {
        setErr('Please upload the toll Transaction History as a .csv (in Excel: Save As → CSV).'); setComputing(false); return;
      }
      if (!rows.length) { setErr('Could not find Plate / Transaction Amount columns in the CSV.'); setComputing(false); return; }
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
          ⤒ Upload toll CSV
          <input type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
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

      {tab === 'registry' && (
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thL}>Plate</th><th style={thL}>Technician</th><th style={thL}>Vehicle</th><th style={thL}>Toll Tag</th></tr></thead>
            <tbody>
              {plates.map(p => (<tr key={p.id}><td style={tdL}>{p.plateRaw}</td><td style={tdL}>{p.tech}</td><td style={tdL}>{p.vehicle || '—'}</td><td style={tdL}>{p.tollTag || '—'}</td></tr>))}
              {!plates.length && <tr><td colSpan={4} style={{ ...tdL, color: '#888780', padding: 20 }}>No plates in the registry yet. Import them first.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
