'use client';
import { useState, useEffect, useCallback } from 'react';
import { type Period } from './helpers';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

interface TcRecord {
  id: string;
  date: string;
  customerName: string;
  jobTitle: string;
  techId: string;
  techName: string;
  office: string;
  isCoJob: boolean;
  apptStatus: string | null;
  futureNonCbVisits: number | null;
  nextVisitDays: number | null;
  closedOut: boolean | null;
  wk1CloseOut: boolean | null;
  wk2CloseOut: boolean | null;
  cb60Day: boolean | null;
  futureCbs: number | null;
  timeAtJobMins: number | null;
  crewLeader?: string | null;
  siteLeader?: string | null;
}

const td: React.CSSProperties = {
  padding: '8px 8px',
  borderBottom: '0.5px solid #F1EFE8',
  fontSize: 12,
  color: '#2C2C2A',
  whiteSpace: 'nowrap',
};

const thBase: React.CSSProperties = {
  padding: '7px 8px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6B6A64',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  background: '#FAFAF8',
  borderBottom: '0.5px solid #E8E7E3',
  letterSpacing: '0.02em',
};

const thFilter: React.CSSProperties = {
  padding: '4px 6px',
  background: '#FAFAF8',
  borderBottom: '0.5px solid #E8E7E3',
};

// Text/number substring filter input
function FilterText({ k, v, set, ph }: { k: string; v: Record<string, string>; set: (k: string, val: string) => void; ph?: string }) {
  return (
    <input
      value={v[k] ?? ''}
      onChange={e => set(k, e.target.value)}
      placeholder={ph || 'filter'}
      style={{ width: '100%', minWidth: 44, boxSizing: 'border-box', padding: '3px 6px', fontSize: 11, border: '0.5px solid #E0DED7', borderRadius: 5, background: '#fff', color: '#2C2C2A' }}
    />
  );
}

// Yes/No/Blank/All dropdown for boolean columns
function FilterBool({ k, v, set }: { k: string; v: Record<string, string>; set: (k: string, val: string) => void }) {
  return (
    <select
      value={v[k] ?? 'All'}
      onChange={e => set(k, e.target.value)}
      style={{ width: '100%', minWidth: 52, boxSizing: 'border-box', padding: '3px 4px', fontSize: 11, border: '0.5px solid #E0DED7', borderRadius: 5, background: '#fff', color: '#2C2C2A', cursor: 'pointer' }}
    >
      <option>All</option>
      <option>Yes</option>
      <option>No</option>
    </select>
  );
}



function BoolBadge({ value, nullLabel = '—' }: { value: boolean | null; nullLabel?: string }) {
  if (value === null || value === undefined) return <span style={{ color: '#B4B2A9' }}>{nullLabel}</span>;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 6,
      fontSize: 11,
      fontWeight: 500,
      background: value ? '#E6F4EE' : '#FDF2F2',
      color: value ? '#27500A' : '#791F1F',
    }}>
      {value ? 'Yes' : 'No'}
    </span>
  );
}

function fmtDate(d: string) {
  const dt = new Date(d);  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}

interface Props {
  weekEnd: Date;
  office: string;
  leaderFilter?: string;
  period?: Period;
}

export function TcAccountabilityTab({ weekEnd, office, leaderFilter = '', period }: Props) {
  const [records, setRecords] = useState<TcRecord[]>([]);
  const [loading, setLoading] = useState(false);
  // Per-column filters. Text columns hold a substring; boolean columns hold 'All' | 'Yes' | 'No'.
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const setCol = (key: string, val: string) => setColFilters(prev => ({ ...prev, [key]: val }));

  // TC Frequency drawer (line charts: monthly + year-over-year)
  const [showFreq, setShowFreq] = useState(false);
  const [freqData, setFreqData] = useState<any>(null);
  const [freqLoading, setFreqLoading] = useState(false);
  const openFreq = async () => {
    setShowFreq(true);
    if (freqData) return;
    setFreqLoading(true);
    try {
      const officeParam = office === 'All' ? 'ALL' : office;
      const res = await fetch(`/api/tc-accountability/frequency?office=${officeParam}`);
      setFreqData(await res.json());
    } catch { /* keep drawer open with empty state */ }
    setFreqLoading(false);
  };
  // Refetch when office changes while closed (so reopening reflects the current office).
  useEffect(() => { setFreqData(null); }, [office]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const officeParam = office === 'All' ? 'ALL' : office;
      const pp = period?.mode === 'month'
        ? `monthStart=${encodeURIComponent(period.monthStart)}&monthEnd=${encodeURIComponent(period.monthEnd)}`
        : `weekEnd=${weekEnd.toLocaleDateString('en-CA')}`;
      const res = await fetch(`/api/tc-accountability?${pp}&office=${officeParam}`);
      const data = await res.json();
      setRecords(data.records || []);
    } catch {
      setRecords([]);
    }
    setLoading(false);
  }, [weekEnd, office, period?.mode === 'month' ? `${(period as any).year}-${(period as any).month}` : 'week']);

  useEffect(() => { loadData(); }, [loadData]);

  // Helpers for filter matching
  const txt = (key: string) => (colFilters[key] ?? '').trim().toLowerCase();
  const boolMatch = (key: string, v: boolean | null) => {
    const f = colFilters[key] ?? 'All';
    if (f === 'All') return true;
    if (f === 'Yes') return v === true;
    if (f === 'No') return v === false;
    return true;
  };
  const inc = (val: string | null | undefined, key: string) => {
    const q = txt(key);
    return !q || (val ?? '').toString().toLowerCase().includes(q);
  };

  const filtered = records.filter(r => {
    const leaderMatch = !leaderFilter || r.crewLeader === leaderFilter;
    return leaderMatch
      && inc(fmtDate(r.date), 'date')
      && inc(r.customerName, 'customer')
      && inc(r.jobTitle, 'appointment')
      && inc(r.techId, 'techId')
      && inc(r.techName, 'techName')
      && boolMatch('coJob', r.isCoJob)
      && inc(r.futureNonCbVisits?.toString() ?? '', 'futureVisits')
      && inc(r.nextVisitDays?.toString() ?? '', 'nextVisitDays')
      && boolMatch('closeOut', r.closedOut)
      && boolMatch('wk1', r.wk1CloseOut)
      && boolMatch('wk2', r.wk2CloseOut)
      && boolMatch('cb60', r.cb60Day)
      && inc(r.futureCbs?.toString() ?? '', 'futureCbs')
      && inc(r.timeAtJobMins != null ? Math.round(r.timeAtJobMins).toString() : '', 'timeAtJob');
  });

  // KPI summary
  const coJobs = filtered.filter(r => r.isCoJob);
  const closedOutCount = coJobs.filter(r => r.closedOut).length;
  const coRate = coJobs.length > 0 ? (closedOutCount / coJobs.length * 100).toFixed(1) : '—';
  const wk1Count = coJobs.filter(r => r.wk1CloseOut).length;
  const cb60Count = filtered.filter(r => r.cb60Day).length;

  return (
    <div>
      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total appointments', value: filtered.length },
          { label: 'CO opportunities', value: coJobs.length },
          { label: 'Closed out', value: `${closedOutCount} (${coRate}%)`, color: typeof coRate !== 'string' || parseFloat(coRate) >= 70 ? '#27500A' : parseFloat(coRate) >= 50 ? '#633806' : '#791F1F' },
          { label: '1 Wk C/O', value: wk1Count },
          { label: '60 Day CBs', value: cb60Count, color: cb60Count > 0 ? '#791F1F' : '#27500A' },
        ].map(tile => (
          <div key={tile.label} style={{ background: '#fff', border: '0.5px solid #E8E7E3', borderRadius: 10, padding: '12px 16px', minWidth: 120 }}>
            <div style={{ fontSize: 20, fontWeight: 500, color: tile.color || '#2C2C2A' }}>{tile.value}</div>
            <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 2 }}>{tile.label}</div>
          </div>
        ))}
      </div>

      {/* Filter summary + clear */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#6B6A64' }}>{filtered.length} of {records.length} records</span>
        {Object.values(colFilters).some(v => v && v !== 'All') && (
          <button
            onClick={() => setColFilters({})}
            style={{ fontSize: 11, padding: '4px 10px', border: '0.5px solid #E0DED7', borderRadius: 6, background: '#fff', color: '#6B6A64', cursor: 'pointer' }}
          >
            Clear filters
          </button>
        )}
        <span style={{ fontSize: 11, color: '#B4B2A9' }}>Filter each column below</span>
        <button
          onClick={openFreq}
          style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 12px', border: '0.5px solid #D3D1C7', borderRadius: 8, background: '#fff', color: '#2C2C2A', cursor: 'pointer', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          📈 TC Frequency
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#B4B2A9', fontSize: 13 }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#B4B2A9', fontSize: 13 }}>
          No TC accountability data for this week yet. Run FR Sync to populate.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '0.5px solid #E8E7E3' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              {/* Column labels */}
              <tr>
                {[
                  'Date','Customer','Appointment','Tech ID','Tech Name','CO Job?',
                  'Future Visits','Next Visit Days','Close Out?','1 Wk C/O','2 Wk C/O','60 Day CB','Future CBs','Time at Job'
                ].map(label => (
                  <th key={label} style={{ ...thBase }}>{label}</th>
                ))}
              </tr>
              {/* Per-column filter row */}
              <tr>
                <th style={thFilter}><FilterText k="date" v={colFilters} set={setCol} ph="filter" /></th>
                <th style={thFilter}><FilterText k="customer" v={colFilters} set={setCol} ph="filter" /></th>
                <th style={thFilter}><FilterText k="appointment" v={colFilters} set={setCol} ph="filter" /></th>
                <th style={thFilter}><FilterText k="techId" v={colFilters} set={setCol} ph="filter" /></th>
                <th style={thFilter}><FilterText k="techName" v={colFilters} set={setCol} ph="filter" /></th>
                <th style={thFilter}><FilterBool k="coJob" v={colFilters} set={setCol} /></th>
                <th style={thFilter}><FilterText k="futureVisits" v={colFilters} set={setCol} ph="#" /></th>
                <th style={thFilter}><FilterText k="nextVisitDays" v={colFilters} set={setCol} ph="#" /></th>
                <th style={thFilter}><FilterBool k="closeOut" v={colFilters} set={setCol} /></th>
                <th style={thFilter}><FilterBool k="wk1" v={colFilters} set={setCol} /></th>
                <th style={thFilter}><FilterBool k="wk2" v={colFilters} set={setCol} /></th>
                <th style={thFilter}><FilterBool k="cb60" v={colFilters} set={setCol} /></th>
                <th style={thFilter}><FilterText k="futureCbs" v={colFilters} set={setCol} ph="#" /></th>
                <th style={thFilter}><FilterText k="timeAtJob" v={colFilters} set={setCol} ph="#" /></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isPending = r.apptStatus === 'pending';
                const rowBg = isPending ? '#FFF8F0' : '#fff';
                const rowHover = isPending ? '#FFF0DC' : '#FAFAF8';
                return (
                <tr key={r.id} style={{ background: rowBg }}
                  onMouseEnter={e => (e.currentTarget.style.background = rowHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                >
                  <td style={td}>{fmtDate(r.date)}</td>
                  <td style={{ ...td, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.customerName}
                    {isPending && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#D97706', background: '#FEF3C7', borderRadius: 4, padding: '1px 5px' }}>PENDING</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.jobTitle}</td>
                  <td style={td}>{r.techId}</td>
                  <td style={td}>{r.techName}</td>
                  <td style={td}><BoolBadge value={r.isCoJob} /></td>
                  <td style={{ ...td, textAlign: 'center' }}>{r.futureNonCbVisits ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>{r.nextVisitDays != null ? `${r.nextVisitDays}d` : '—'}</td>
                  <td style={td}><BoolBadge value={r.closedOut} /></td>
                  <td style={td}><BoolBadge value={r.wk1CloseOut} /></td>
                  <td style={td}><BoolBadge value={r.wk2CloseOut} /></td>
                  <td style={td}><BoolBadge value={r.cb60Day} /></td>
                  <td style={{ ...td, textAlign: 'center' }}>{r.futureCbs ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    {r.timeAtJobMins != null ? `${Math.round(r.timeAtJobMins)}m` : '—'}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TC Frequency drawer — monthly + year-over-year line charts */}
      {showFreq && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowFreq(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 1100, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '0.5px solid #E8E7E3' }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: '#2C2C2A' }}>
                TC Frequency <span style={{ fontSize: 12, fontWeight: 400, color: '#888780', marginLeft: 6 }}>— avg. days between visits {office !== 'All' && office !== 'ALL' ? `· ${office}` : ''}</span>
              </div>
              <button onClick={() => setShowFreq(false)} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: '#888780', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ overflow: 'auto', padding: 20 }}>
              {freqLoading ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#B4B2A9' }}>Loading…</div>
              ) : !freqData || !freqData.monthly?.length ? (
                <div style={{ padding: 60, textAlign: 'center', color: '#B4B2A9' }}>No TC Frequency data.</div>
              ) : (
                <>
                  {freqData.current && (
                    <div style={{ marginBottom: 20, display: 'flex', gap: 24, alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontSize: 28, fontWeight: 600, color: '#2C2C2A' }}>{freqData.current.value?.toFixed(1) ?? '—'}</span>
                        <span style={{ fontSize: 13, color: '#888780', marginLeft: 6 }}>days ({freqData.current.month})</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#888780' }}>Standard: {freqData.standard} days</div>
                    </div>
                  )}

                  {/* Continuous monthly */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2A', marginBottom: 8 }}>Monthly trend</div>
                  <div style={{ width: '100%', height: 280, marginBottom: 28 }}>
                    <ResponsiveContainer>
                      <LineChart data={freqData.monthly} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1EFE8" />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#888780' }} interval="preserveStartEnd" minTickGap={24} />
                        <YAxis tick={{ fontSize: 10, fill: '#888780' }} width={36} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '0.5px solid #E8E7E3' }} formatter={(v: any) => [`${v} days`, 'TC Freq']} />
                        <ReferenceLine y={freqData.standard} stroke="#C99A2E" strokeDasharray="4 4" label={{ value: `Std ${freqData.standard}`, fontSize: 10, fill: '#C99A2E', position: 'right' }} />
                        <Line type="monotone" dataKey="value" stroke="#0052cc" strokeWidth={2} dot={false} connectNulls />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Year-over-year */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#2C2C2A', marginBottom: 8 }}>Year-over-year</div>
                  <div style={{ width: '100%', height: 300 }}>
                    <ResponsiveContainer>
                      <LineChart data={freqData.yoy.matrix} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F1EFE8" />
                        <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#888780' }} />
                        <YAxis tick={{ fontSize: 10, fill: '#888780' }} width={36} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '0.5px solid #E8E7E3' }} formatter={(v: any) => [`${v} days`]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <ReferenceLine y={freqData.standard} stroke="#C99A2E" strokeDasharray="4 4" />
                        {freqData.yoy.years.map((y: number, i: number) => (
                          <Line key={y} type="monotone" dataKey={String(y)} stroke={YOY_COLORS[i % YOY_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: 11, color: '#B4B2A9', marginTop: 12 }}>
                    Note: the most recent month(s) may read low until future visits are booked. Lower = more frequent visits.
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const YOY_COLORS = ['#B4B2A9', '#8AB4D6', '#5A8FBD', '#0052cc', '#C99A2E'];
