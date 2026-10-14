'use client';
export const dynamic = 'force-dynamic';
import { useState } from 'react';

const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—';
const fmtDate = (d: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

// Minimal CSV parser handling quoted fields (OnTheClock quotes names with commas).
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

export default function ClockVsArrivalPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [fileName, setFileName] = useState('');
  const [onlyFlags, setOnlyFlags] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name); setErr(''); setLoading(true); setData(null);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      const header = parsed[0].map(h => h.trim());
      const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());
      const iName = idx('Employee Name'), iNum = idx('Employee Number'), iDate = idx('Date'),
        iTot = idx('Total Hours'), iIn = idx('First Punch In'), iOut = idx('Last Punch Out');
      if (iName < 0 || iDate < 0 || iIn < 0) { setErr('CSV missing expected columns (Employee Name / Date / First Punch In).'); setLoading(false); return; }
      const rows = parsed.slice(1).map(r => ({
        employeeName: r[iName]?.trim(), employeeNumber: r[iNum]?.trim(), date: r[iDate]?.trim(),
        totalHours: iTot >= 0 ? parseFloat(r[iTot]) : null,
        firstPunchIn: r[iIn]?.trim(), lastPunchOut: iOut >= 0 ? r[iOut]?.trim() : null,
      })).filter(r => r.employeeName && r.date);
      const resp = await fetch('/api/payroll/clock-vs-arrival', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
      const j = await resp.json();
      if (j.error) { setErr(j.error); setLoading(false); return; }
      setData(j);
    } catch (e: any) { setErr('Failed to parse/upload: ' + String(e).slice(0, 120)); }
    setLoading(false);
  }

  const th: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0 };
  const td: React.CSSProperties = { textAlign: 'center', padding: '7px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

  const rows = data ? (onlyFlags ? data.rows.filter((r: any) => r.status === 'FLAG') : data.rows) : [];

  function statusCell(r: any) {
    if (r.status === 'FLAG') return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#FCEBEB', color: '#b91c1c', fontWeight: 600 }}>⚑ Flag</span>;
    if (r.status === 'OK') return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: '#E1F5EE', color: '#0F6E56' }}>OK</span>;
    if (r.status === 'NO_MATCH') return <span style={{ fontSize: 11, color: '#BA7517' }}>No match</span>;
    if (r.status === 'NO_BOUNCIE') return <span style={{ fontSize: 11, color: '#888780' }}>No GPS data</span>;
    return r.status;
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/payroll/us" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← US Payroll</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>Clock-In vs. Arrival</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 20px', lineHeight: 1.6 }}>
        Upload the OnTheClock time-card CSV. The Hub compares each tech's clock-in/out against their actual arrival at the first stop and departure from the last stop (from Bouncie GPS), and flags any gap over 10 minutes — e.g. clocked in well before the truck reached the first customer.
      </p>

      <label style={{ display: 'inline-block', fontSize: 13, padding: '10px 18px', borderRadius: 8, border: '0.5px solid #534AB7', background: '#fff', color: '#534AB7', fontWeight: 500, cursor: 'pointer' }}>
        {loading ? 'Processing…' : '↑ Upload OnTheClock CSV'}
        <input type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} disabled={loading} />
      </label>
      {fileName && <span style={{ fontSize: 12, color: '#888780', marginLeft: 12 }}>{fileName}</span>}
      {err && <div style={{ fontSize: 13, color: '#b91c1c', background: '#FCEBEB', border: '0.5px solid #F7C1C1', borderRadius: 8, padding: '10px 12px', marginTop: 14 }}>{err}</div>}

      {data && (<>
        <div style={{ display: 'flex', gap: 12, margin: '20px 0', flexWrap: 'wrap' }}>
          {[['Rows', data.summary.total, '#2C2C2A'], ['Flagged', data.summary.flagged, data.summary.flagged ? '#b91c1c' : '#888780'], ['Paid-not-working (min)', data.summary.totalPaidNotWorkingMin, data.summary.totalPaidNotWorkingMin ? '#BA7517' : '#888780'], ['No match', data.summary.noMatch, '#888780'], ['No GPS data', data.summary.noBouncie, '#888780']].map(([label, val, color]: any) => (
            <div key={label} style={{ border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '12px 16px', background: '#fff', minWidth: 110 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
              <div style={{ fontSize: 11, color: '#888780' }}>{label}</div>
            </div>
          ))}
        </div>
        <label style={{ fontSize: 13, color: '#2C2C2A', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyFlags} onChange={e => setOnlyFlags(e.target.checked)} /> Show flagged only
        </label>
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>Employee</th><th style={th}>Date</th>
                <th style={th}>Clock In</th><th style={th}>Arrived</th><th style={th}>In Gap</th>
                <th style={th}>Clock Out</th><th style={th}>Departed</th><th style={th}>Out Gap</th>
                <th style={th}>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((r: any, i: number) => (
                  <tr key={i} style={{ background: r.status === 'FLAG' ? '#FDF6F6' : undefined }}>
                    <td style={tdL}>{r.employeeName}{r.techName && r.techName !== r.employeeName ? <span style={{ color: '#B4B2A9', fontSize: 11 }}> → {r.techName}</span> : null}</td>
                    <td style={td}>{fmtDate(r.date)}</td>
                    <td style={td}>{fmtTime(r.clockIn)}</td>
                    <td style={td}>{fmtTime(r.arrival)}</td>
                    <td style={{ ...td, color: r.inFlag ? '#b91c1c' : '#2C2C2A', fontWeight: r.inFlag ? 600 : 400 }}>{r.inGapMin !== null && r.inGapMin !== undefined ? `${r.inGapMin}m` : '—'}</td>
                    <td style={td}>{fmtTime(r.clockOut)}</td>
                    <td style={td}>{fmtTime(r.departure)}</td>
                    <td style={{ ...td, color: r.outFlag ? '#b91c1c' : '#2C2C2A', fontWeight: r.outFlag ? 600 : 400 }}>{r.outGapMin !== null && r.outGapMin !== undefined ? `${r.outGapMin}m` : '—'}</td>
                    <td style={td}>{statusCell(r)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={9} style={{ ...td, color: '#888780', padding: 20 }}>No rows to show.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <p style={{ fontSize: 11, color: '#B4B2A9', marginTop: 10, lineHeight: 1.6 }}>
          "In Gap" = minutes the tech was clocked in before actually arriving at their first stop (positive = paid but not yet working). "Out Gap" = minutes clocked in after leaving the last stop. Gaps over 10 min are flagged. "No GPS data" means Bouncie hadn't computed an arrival for that tech/day (e.g. no matched stops).
        </p>
      </>)}
    </div>
  );
}
