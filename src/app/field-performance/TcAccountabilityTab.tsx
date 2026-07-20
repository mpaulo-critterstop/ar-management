'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSort, sortRows, SortableTh } from './helpers';

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
  padding: '8px 12px',
  borderBottom: '0.5px solid #F1EFE8',
  fontSize: 12,
  color: '#2C2C2A',
  whiteSpace: 'nowrap',
};



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
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
}

interface Props {
  weekEnd: Date;
  office: string;
  leaderFilter?: string;
}

export function TcAccountabilityTab({ weekEnd, office, leaderFilter = '' }: Props) {
  const [records, setRecords] = useState<TcRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const sort = useSort('date', 'desc');
  const [teamFilter, setTeamFilter] = useState('All');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const wk = weekEnd.toLocaleDateString('en-CA');
      const officeParam = office === 'All' ? 'ALL' : office;
      const res = await fetch(`/api/tc-accountability?weekEnd=${wk}&office=${officeParam}`);
      const data = await res.json();
      setRecords(data.records || []);
    } catch {
      setRecords([]);
    }
    setLoading(false);
  }, [weekEnd, office]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredUnsorted = records.filter(r => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      r.techName.toLowerCase().includes(q) ||
      r.techId.toLowerCase().includes(q) ||
      r.customerName.toLowerCase().includes(q);
    const leaderMatch = !leaderFilter || r.crewLeader === leaderFilter || r.siteLeader === leaderFilter;
    return matchesSearch && leaderMatch;
  });
  const filtered = sortRows(filteredUnsorted, sort, {
    date:         r => r.date,
    customer:     r => r.customerName ?? '',
    appointment:  r => r.jobTitle ?? '',
    techId:       r => r.techId,
    techName:     r => r.techName ?? '',
    coJob:        r => r.isCoJob === null ? null : (r.isCoJob ? 1 : 0),
    futureVisits: r => r.futureNonCbVisits,
    nextVisitDays:r => r.nextVisitDays,
    closeOut:     r => r.closedOut === null ? null : (r.closedOut ? 1 : 0),
    wk1:          r => r.wk1CloseOut === null ? null : (r.wk1CloseOut ? 1 : 0),
    wk2:          r => r.wk2CloseOut === null ? null : (r.wk2CloseOut ? 1 : 0),
    cb60:         r => r.cb60Day === null ? null : (r.cb60Day ? 1 : 0),
    futureCbs:    r => r.futureCbs,
    timeAtJob:    r => r.timeAtJobMins,
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

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tech or customer..."
          style={{ padding: '6px 10px', fontSize: 12, border: '0.5px solid #E8E7E3', borderRadius: 8, background: '#fff', color: '#2C2C2A', width: 240 }}
        />
        <span style={{ fontSize: 12, color: '#B4B2A9' }}>{filtered.length} records</span>
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
              <tr>
                <SortableTh sortKey="date" sort={sort}>Date</SortableTh>
                <SortableTh sortKey="customer" sort={sort}>Customer</SortableTh>
                <SortableTh sortKey="appointment" sort={sort}>Appointment</SortableTh>
                <SortableTh sortKey="techId" sort={sort}>Tech ID</SortableTh>
                <SortableTh sortKey="techName" sort={sort}>Tech Name</SortableTh>
                <SortableTh sortKey="coJob" sort={sort}>CO Job?</SortableTh>
                <SortableTh sortKey="futureVisits" sort={sort}>Future Visits</SortableTh>
                <SortableTh sortKey="nextVisitDays" sort={sort}>Next Visit Days</SortableTh>
                <SortableTh sortKey="closeOut" sort={sort}>Close Out?</SortableTh>
                <SortableTh sortKey="wk1" sort={sort}>1 Wk C/O</SortableTh>
                <SortableTh sortKey="wk2" sort={sort}>2 Wk C/O</SortableTh>
                <SortableTh sortKey="cb60" sort={sort}>60 Day CB</SortableTh>
                <SortableTh sortKey="futureCbs" sort={sort}>Future CBs</SortableTh>
                <SortableTh sortKey="timeAtJob" sort={sort}>Time at Job</SortableTh>
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
                  <td style={{ ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.customerName}
                    {isPending && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: '#D97706', background: '#FEF3C7', borderRadius: 4, padding: '1px 5px' }}>PENDING</span>}
                  </td>
                  <td style={{ ...td, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.jobTitle}</td>
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
    </div>
  );
}
