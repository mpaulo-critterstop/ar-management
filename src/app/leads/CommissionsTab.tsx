'use client';
import { useEffect, useState, useCallback } from 'react';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ROW_DEFS: { key: string; label: string; kind?: 'delta' }[] = [
  { key: 'bookedRevenue', label: 'Booked Revenue' },
  { key: 'cumulativeBookedRevenue', label: 'Total Cumulative Booked Rev.' },
  { key: 'prePeriodDelta', label: 'Pre-Period Delta', kind: 'delta' },
  { key: 'adjustedRevenue', label: 'Adjusted Booked Revenue' },
  { key: 'wildlifeCommission', label: 'Wildlife Commission' },
  { key: 'pestControlComm', label: 'Pest Control Commission' },
  { key: 'otherAdjustment', label: 'Other Adjustments', kind: 'delta' },
  { key: 'totalCommission', label: 'Total Commission' },
];

// Lead-bucket PMs (Blake, Han, Cynthia) get extra rows: # leads, rev/lead, and the per-bucket
// commission breakdown — matching the FPEM Sales Commission sheet's lead-bucket sections.
const BUCKET_ROW_DEFS: { key: string; label: string; kind?: 'delta'; fmt?: 'int' | 'money' }[] = [
  { key: 'bookedRevenue', label: 'Booked Revenue' },
  { key: 'leadCount', label: '# of Leads', fmt: 'int' },
  { key: 'revPerLead', label: 'Booked Revenue / Lead' },
  { key: 'cumulativeBookedRevenue', label: 'Total Cumulative Booked Rev.' },
  { key: 'prePeriodDelta', label: 'Pre-Period Delta', kind: 'delta' },
  { key: 'adjustedRevenue', label: 'Adjusted Booked Revenue' },
  { key: 'adjustedRevPerLead', label: 'Adjusted Booked Revenue / Lead' },
  { key: 'bucket:0', label: '$700 - $1,000 (8%)' },
  { key: 'bucket:1', label: '$1,000 - $1,200 (10%)' },
  { key: 'bucket:2', label: '$1,200 - $1,400 (12%)' },
  { key: 'bucket:3', label: '>$1,400 (14%)' },
  { key: 'wildlifeCommission', label: 'Wildlife Commission' },
  { key: 'pestControlComm', label: 'Pest Control Commission' },
  { key: 'otherAdjustment', label: 'Other Adjustments', kind: 'delta' },
  { key: 'totalCommission', label: 'Total Commission' },
];

export function CommissionsTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editCell, setEditCell] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/leads/commissions?year=${year}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  // month index helper: normalize both history & live records to a flat value map
  function cell(monthRec: any, key: string): number | null | undefined {
    if (!monthRec || monthRec.empty) return undefined;
    if (key === 'adjustedRevenue') return monthRec.adjustedRevenue ?? monthRec.adjustedBookedRevenue;
    // Per-bucket commission amount (lead_bucket plans, live months only).
    if (key.startsWith('bucket:')) {
      const idx = Number(key.split(':')[1]);
      return monthRec.buckets?.[idx]?.amount;
    }
    // leadCount/revPerLead/adjustedRevPerLead come through on live months; history may carry numLeads.
    if (key === 'leadCount') return monthRec.leadCount ?? monthRec.numLeads;
    return monthRec[key];
  }

  // Format a value per row type: money by default, integer for counts.
  function fmtRow(v: number | null | undefined, rowFmt?: 'int' | 'money') {
    if (v === null || v === undefined) return '—';
    if (rowFmt === 'int') return Math.round(v).toLocaleString('en-US');
    return fmt(v);
  }

  async function saveEdit(pmName: string, month: number, field: string) {
    // Tolerate "$", commas, and spaces (e.g. "$1,200.50") — parse just the number.
    const cleaned = editVal.replace(/[^0-9.\-]/g, '');
    const val = parseFloat(cleaned) || 0;
    const res = await fetch('/api/leads/commissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pmName, year, month, [field]: val }),
    });
    if (!res.ok) {
      alert('Save failed — the value was not stored. Please try again.');
    }
    setEditCell(null);
    setEditVal('');
    load();
  }

  const rows = data?.rows || [];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          style={{ fontSize: 13, padding: '7px 12px', borderRadius: 9, border: '0.5px solid #D3D1C7', color: '#2C2C2A', cursor: 'pointer' }}>
          {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#888780' }}>
          Months through June 2026 are finalized historical figures; July 2026 onward is live.
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading commissions...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No commission plans. Add a structure to a PM in Manage PMs.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {rows.map((pm: any) => (
            <div key={pm.pmName} style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
              <div style={{ padding: '10px 14px', background: '#F8F7F4', fontWeight: 600, fontSize: 14, color: '#2C2C2A', borderBottom: '0.5px solid #E8E7E3' }}>
                {pm.pmName}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#FCFBF9' }}>
                      <th style={{ textAlign: 'left', padding: '6px 12px', color: '#888780', fontWeight: 500, position: 'sticky', left: 0, background: '#FCFBF9', minWidth: 170 }}>Metric</th>
                      {MONTHS.map((m, i) => {
                        const rec = pm.months[i];
                        const finalized = rec && !rec.empty && (rec.source === 'history' || rec.finalized);
                        return (
                          <th key={m} style={{ textAlign: 'right', padding: '6px 10px', color: '#888780', fontWeight: 500, minWidth: 78, whiteSpace: 'nowrap' }}>
                            {m}
                            {finalized && <span title="Finalized" style={{ marginLeft: 3, color: '#1D9E75', fontSize: 10 }}>🔒</span>}
                            {rec && !rec.empty && rec.source === 'live' && <span title="Live" style={{ marginLeft: 3, color: '#0052cc', fontSize: 9 }}>●</span>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(pm.method === 'lead_bucket' ? BUCKET_ROW_DEFS : ROW_DEFS).map((rd: any) => (
                      <tr key={rd.key} style={{ borderTop: '0.5px solid #F1EFE8' }}>
                        <td style={{ padding: '6px 12px', color: rd.key === 'totalCommission' ? '#2C2C2A' : '#64748b', fontWeight: rd.key === 'totalCommission' ? 600 : 400, position: 'sticky', left: 0, background: '#fff', paddingLeft: rd.key.startsWith('bucket:') ? 24 : 12 }}>
                          {rd.label}
                        </td>
                        {MONTHS.map((_, i) => {
                          const rec = pm.months[i];
                          const v = cell(rec, rd.key);
                          const editable = rec && !rec.empty && rec.source === 'live' && (rd.key === 'pestControlComm' || rd.key === 'otherAdjustment');
                          const cellId = `${pm.pmName}|${i + 1}|${rd.key}`;
                          const isEditing = editCell === cellId;
                          return (
                            <td key={i}
                              onClick={() => { if (editable) { setEditCell(cellId); setEditVal(String(v ?? 0)); } }}
                              style={{
                                padding: '6px 10px', textAlign: 'right',
                                color: rd.kind === 'delta' && typeof v === 'number' && v < 0 ? '#A32D2D'
                                     : rd.kind === 'delta' && typeof v === 'number' && v > 0 ? '#1D9E75'
                                     : rd.key === 'totalCommission' ? '#2C2C2A' : '#444441',
                                fontWeight: rd.key === 'totalCommission' ? 600 : 400,
                                cursor: editable ? 'pointer' : 'default',
                                background: editable ? '#FCFBF6' : 'transparent',
                              }}>
                              {isEditing ? (
                                <input autoFocus value={editVal}
                                  onChange={e => setEditVal(e.target.value)}
                                  onBlur={() => saveEdit(pm.pmName, i + 1, rd.key)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(pm.pmName, i + 1, rd.key); if (e.key === 'Escape') setEditCell(null); }}
                                  style={{ width: 64, fontSize: 12, textAlign: 'right', border: '1px solid #0052cc', borderRadius: 4, padding: '2px 4px' }} />
                              ) : fmtRow(v, rd.fmt)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
