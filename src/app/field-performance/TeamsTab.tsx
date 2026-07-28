'use client';
import { useEffect, useState } from 'react';
import { scoreBadge, card, cardHead, th, td, useSort, sortRows, SortableTh , periodParams, type Period } from './helpers';

interface Props { office: string; weekEnd: Date; period?: Period; }

export function TeamsTab({ office, weekEnd, period }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const crewSort = useSort('avgScore', 'desc');
  const siteSort = useSort('avgScore', 'desc');

  const periodKey = period?.mode === 'month' ? `m${period.year}-${period.month}` : weekEnd.toLocaleDateString('en-CA');
  useEffect(() => {
    setLoading(true);
    const pp = periodParams(period ?? { mode: 'week', week: weekEnd });
    fetch(`/api/field-performance/teams?${pp}&office=${office}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [office, periodKey]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#b0aea6' }}>Loading...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#b0aea6' }}>No data available.</div>;

  const { crewLeaders, siteLeaders } = data;
  const sortedCrew = sortRows(crewLeaders as any[], crewSort, {
    leader:          c => c.leader ?? '',
    office:          c => c.office ?? '',
    techCount:       c => c.techCount,
    avgScore:        c => c.avgScore,
    avgCloseOutPct:  c => c.avgCloseOutPct,
    avgCallbackRate: c => c.avgCallbackRate,
    avgDriving:      c => c.avgDriving,
    avgRevEff:       c => c.avgRevEff,
    avgReservice:    c => c.avgReservice,
    avgCompletion:   c => c.avgCompletion,
    avgReliability:  c => c.avgReliability,
  });
  const sortedSite = sortRows(siteLeaders as any[], siteSort, {
    leader:    s => s.leader ?? '',
    office:    s => s.office ?? '',
    crewCount: s => s.crewCount,
    techCount: s => s.techCount,
    avgScore:  s => s.avgScore,
    wpAvg:     s => s.wpAvg,
    pmpAvg:    s => s.pmpAvg,
  });

  const pct = (v: number | null) => v !== null && v !== undefined ? (v * 100).toFixed(0) + '%' : '—';

  return (
    <div>
      <div style={card}>
        <div style={cardHead}>By crew leader</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <SortableTh sortKey="leader" sort={crewSort} style={{ width: 160 }}>Crew leader</SortableTh>
                <SortableTh sortKey="office" sort={crewSort} style={{ width: 60 }}>Office</SortableTh>
                <SortableTh sortKey="techCount" sort={crewSort} style={{ width: 55 }}>Techs</SortableTh>
                <SortableTh sortKey="avgScore" sort={crewSort} style={{ width: 95 }}>Avg score</SortableTh>
                <SortableTh sortKey="avgCloseOutPct" sort={crewSort} style={{ width: 65 }}>Avg CO%</SortableTh>
                <SortableTh sortKey="avgCallbackRate" sort={crewSort} style={{ width: 72 }}>Avg CB rate</SortableTh>
                <SortableTh sortKey="avgDriving" sort={crewSort} style={{ width: 72 }}>Avg driving</SortableTh>
                <SortableTh sortKey="avgRevEff" sort={crewSort} style={{ width: 70 }}>Avg RevEff</SortableTh>
                <SortableTh sortKey="avgReservice" sort={crewSort} style={{ width: 78 }}>Avg Reservice</SortableTh>
                <SortableTh sortKey="avgCompletion" sort={crewSort} style={{ width: 82 }}>Avg Completion</SortableTh>
                <SortableTh sortKey="avgReliability" sort={crewSort} style={{ width: 80 }}>Avg Reliability</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortedCrew.length === 0 ? (
                <tr><td colSpan={11} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 24 }}>No data for this week yet.</td></tr>
              ) : sortedCrew.map((c: any) => (
                <tr key={c.leader}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontWeight: 500 }}>{c.leader}</td>
                  <td style={td}>{c.office}</td>
                  <td style={td}>{c.techCount}</td>
                  <td style={td}>{scoreBadge(c.avgScore)}</td>
                  <td style={td}>{pct(c.avgCloseOutPct)}</td>
                  <td style={td}>{pct(c.avgCallbackRate)}</td>
                  <td style={td}>{pct(c.avgDriving)}</td>
                  <td style={td}>{pct(c.avgRevEff)}</td>
                  <td style={td}>{pct(c.avgReservice)}</td>
                  <td style={td}>{pct(c.avgCompletion)}</td>
                  <td style={td}>{pct(c.avgReliability)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={cardHead}>By site leader</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <SortableTh sortKey="leader" sort={siteSort} style={{ width: 160 }}>Site leader</SortableTh>
                <SortableTh sortKey="office" sort={siteSort} style={{ width: 60 }}>Office</SortableTh>
                <SortableTh sortKey="crewCount" sort={siteSort} style={{ width: 55 }}>Crews</SortableTh>
                <SortableTh sortKey="techCount" sort={siteSort} style={{ width: 55 }}>Techs</SortableTh>
                <SortableTh sortKey="avgScore" sort={siteSort} style={{ width: 95 }}>Avg score</SortableTh>
                <SortableTh sortKey="wpAvg" sort={siteSort} style={{ width: 90 }}>WP avg</SortableTh>
                <SortableTh sortKey="pmpAvg" sort={siteSort} style={{ width: 90 }}>PMP avg</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortedSite.length === 0 ? (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#b0aea6', padding: 24 }}>No data for this week yet.</td></tr>
              ) : sortedSite.map((s: any) => (
                <tr key={s.leader}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontWeight: 500 }}>{s.leader}</td>
                  <td style={td}>{s.office}</td>
                  <td style={td}>{s.crewCount}</td>
                  <td style={td}>{s.techCount}</td>
                  <td style={td}>{scoreBadge(s.avgScore)}</td>
                  <td style={td}>{scoreBadge(s.wpAvg)}</td>
                  <td style={td}>{scoreBadge(s.pmpAvg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
