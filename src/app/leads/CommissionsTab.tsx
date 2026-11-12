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
          style={{ fontSize: 13, padding: '7px 12px', borderRadius: 9, border: '1px solid #35353C', background: '#26262C', color: '#F0EEE8', cursor: 'pointer' }}>
          {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#908E85' }}>
          Months through June 2026 are finalized historical figures; July 2026 onward is live.
        </span>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading commissions...</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No commission plans. Add a structure to a PM in Manage PMs.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {(() => {
            // Summary totals across all PMs, per month, for the requested metrics.
            const SUMMARY_DEFS: { key: string; label: string; kind?: 'delta' }[] = [
              { key: 'bookedRevenue', label: 'Booked Revenue' },
              { key: 'prePeriodDelta', label: 'Pre-Period Delta', kind: 'delta' },
              { key: 'adjustedRevenue', label: 'Adj. Booked Revenue' },
              { key: 'wildlifeCommission', label: 'Wildlife Commission' },
              { key: 'pestControlComm', label: 'Pest Control Commission' },
              { key: 'otherAdjustment', label: 'Other Adjustments', kind: 'delta' },
              { key: 'totalCommission', label: 'Total Commission' },
            ];
            // sum[key][monthIdx] = total across PMs (null if no PM had a value that month)
            const sum: Record<string, (number | null)[]> = {};
            for (const rd of SUMMARY_DEFS) {
              sum[rd.key] = MONTHS.map((_, i) => {
                let total = 0; let any = false;
                for (const pm of rows) {
                  const v = cell(pm.months[i], rd.key);
                  if (typeof v === 'number') { total += v; any = true; }
                }
                return any ? total : null;
              });
            }
            return (
              <div style={{ border: '0.5px solid #43B892', borderRadius: 12, overflow: 'hidden', background: '#1C1C21' }}>
                <div style={{ padding: '10px 14px', background: '#143229', fontWeight: 600, fontSize: 14, color: '#F0EEE8', borderBottom: '0.5px solid #2e5a4c' }}>
                  All PMs — Summary Totals
                </div>
                <div style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarGutter: 'stable' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#232329' }}>
                        <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#908E85', fontWeight: 600, position: 'sticky', left: 0, top: 0, background: '#232329', minWidth: 170, zIndex: 3 }}>Metric</th>
                        {MONTHS.map(m => <th key={m} style={{ textAlign: 'right', padding: '10px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#908E85', fontWeight: 600, minWidth: 78, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#232329', zIndex: 2 }}>{m}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {SUMMARY_DEFS.map(rd => (
                        <tr key={rd.key} style={{ borderTop: '0.5px solid #232329' }}>
                          <td style={{ padding: '6px 12px', color: rd.key === 'totalCommission' ? '#F0EEE8' : '#C9C7BF', fontWeight: rd.key === 'totalCommission' ? 600 : 400, position: 'sticky', left: 0, background: '#1C1C21' }}>{rd.label}</td>
                          {MONTHS.map((_, i) => {
                            const v = sum[rd.key][i];
                            return (
                              <td key={i} style={{
                                padding: '6px 10px', textAlign: 'right',
                                color: rd.kind === 'delta' && typeof v === 'number' && v < 0 ? '#E57C7C' : rd.kind === 'delta' && typeof v === 'number' && v > 0 ? '#43B892' : rd.key === 'totalCommission' ? '#F0EEE8' : '#C9C7BF',
                                fontWeight: rd.key === 'totalCommission' ? 600 : 400,
                              }}>{v === null ? '—' : fmt(v)}</td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: '#908E85', margin: '16px 0 10px' }}>Individual PMs</div>
          <div style={{ maxHeight: '60vh', overflowY: 'auto', scrollbarGutter: 'stable', paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {rows.map((pm: any) => (
            <div key={pm.pmName} style={{ border: '0.5px solid #2A2A30', borderRadius: 12, overflow: 'hidden', background: '#1C1C21' }}>
              <div style={{ padding: '10px 14px', background: '#232329', fontWeight: 600, fontSize: 14, color: '#F0EEE8', borderBottom: '0.5px solid #2A2A30' }}>
                {pm.pmName}
              </div>
              <div style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarGutter: 'stable' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#232329' }}>
                      <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#908E85', fontWeight: 600, position: 'sticky', left: 0, top: 0, background: '#232329', minWidth: 170, zIndex: 3 }}>Metric</th>
                      {MONTHS.map((m, i) => {
                        const rec = pm.months[i];
                        const finalized = rec && !rec.empty && (rec.source === 'history' || rec.finalized);
                        return (
                          <th key={m} style={{ textAlign: 'right', padding: '6px 10px', color: '#908E85', fontWeight: 500, minWidth: 78, whiteSpace: 'nowrap' }}>
                            {m}
                            {finalized && <span title="Finalized" style={{ marginLeft: 3, color: '#43B892', fontSize: 10 }}>🔒</span>}
                            {rec && !rec.empty && rec.source === 'live' && <span title="Live" style={{ marginLeft: 3, color: '#5B9BE0', fontSize: 9 }}>●</span>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {(pm.method === 'lead_bucket' ? BUCKET_ROW_DEFS : ROW_DEFS).map((rd: any) => (
                      <tr key={rd.key} style={{ borderTop: '0.5px solid #232329' }}>
                        <td style={{ padding: '6px 12px', color: rd.key === 'totalCommission' ? '#F0EEE8' : '#C9C7BF', fontWeight: rd.key === 'totalCommission' ? 600 : 400, position: 'sticky', left: 0, background: '#1C1C21', paddingLeft: rd.key.startsWith('bucket:') ? 24 : 12 }}>
                          {rd.label}
                        </td>
                        {MONTHS.map((_, i) => {
                          const rec = pm.months[i];
                          const v = cell(rec, rd.key);
                          // pestControlComm is now COMPUTED from pest_sales (not manual). Only
                          // otherAdjustment remains a manual override.
                          const editable = rec && !rec.empty && rec.source === 'live' && rd.key === 'otherAdjustment';
                          const cellId = `${pm.pmName}|${i + 1}|${rd.key}`;
                          const isEditing = editCell === cellId;
                          return (
                            <td key={i}
                              onClick={() => { if (editable) { setEditCell(cellId); setEditVal(String(v ?? 0)); } }}
                              style={{
                                padding: '6px 10px', textAlign: 'right',
                                color: rd.kind === 'delta' && typeof v === 'number' && v < 0 ? '#E57C7C'
                                     : rd.kind === 'delta' && typeof v === 'number' && v > 0 ? '#43B892'
                                     : rd.key === 'totalCommission' ? '#F0EEE8' : '#C9C7BF',
                                fontWeight: rd.key === 'totalCommission' ? 600 : 400,
                                cursor: editable ? 'pointer' : 'default',
                                background: editable ? '#2e2a1a' : 'transparent',
                              }}>
                              {isEditing ? (
                                <input autoFocus value={editVal}
                                  onChange={e => setEditVal(e.target.value)}
                                  onBlur={() => saveEdit(pm.pmName, i + 1, rd.key)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(pm.pmName, i + 1, rd.key); if (e.key === 'Escape') setEditCell(null); }}
                                  style={{ width: 64, fontSize: 12, textAlign: 'right', border: '1px solid #5B9BE0', borderRadius: 4, padding: '2px 4px', background: '#26262C', color: '#F0EEE8' }} />
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
        </div>
      )}
    </div>
  );
}
