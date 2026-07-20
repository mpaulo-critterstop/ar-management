'use client';
import { useEffect, useState } from 'react';
import { scoreBadge, scoreBar, scoreColors, teamPill, kpiTile, card, cardHead, th, td,
  TEAM_COLORS, BG_TILE, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT,
  useSort, sortRows, SortableTh , periodParams, type Period } from './helpers';

interface Props { office: string; weekEnd: Date; leaderFilter?: string; period?: Period; }

export function ScoreboardTab({ office, weekEnd, leaderFilter = '', period }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sort = useSort('score', 'desc');

  useEffect(() => {
    setLoading(true);
    setError(null);
    const wk = weekEnd.toLocaleDateString('en-CA');
    fetch(`/api/field-performance/scoreboard?week=${wk}&office=${office}&leader=${encodeURIComponent(leaderFilter)}`)
      .then(r => r.json())
      .then(d => { if (d.error) { setError(d.error); } else { setData(d); } setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [office, weekEnd, leaderFilter]);

  if (loading) return (
    <div style={{ padding: 48, textAlign: 'center', color: TEXT_MUTED }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>Loading scores...</div>
    </div>
  );
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#7A1A1A' }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: TEXT_MUTED }}>No data for this week yet.</div>;

  const { summary, officeBreakdown, teamBreakdown, topPerformers } = data;
  const sortedPerformers = sortRows(topPerformers as any[], sort, {
    name:        t => t.name ?? '',
    team:        t => t.team ?? '',
    office:      t => t.office ?? '',
    score:       t => t.score,
    co:          t => t.closeOutPct,
    cb:          t => t.callbackRate,
    driving:     t => t.drivingScore,
    reliability: t => t.reliabilityScore,
  });
  const scoreColor = scoreColors(summary.avgScore);

  return (
    <div>
      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
        {kpiTile(
          <span style={{ color: scoreColor.text }}>{summary.avgScore ? (summary.avgScore * 100).toFixed(1) + '%' : '—'}</span>,
          'Company avg', 'Target ≥90%', scoreColor.bar
        )}
        {kpiTile(summary.activeTechs ?? 0, 'Active techs', 'WP · PMP · IP', ACCENT)}
        {kpiTile(
          summary.avgCloseOutPct ? (summary.avgCloseOutPct * 100).toFixed(0) + '%' : '—',
          'Avg close-out', 'Target 85%',
          summary.avgCloseOutPct >= 0.85 ? '#22C55E' : '#F59E0B'
        )}
        {kpiTile(
          summary.avgCallbackRate ? (summary.avgCallbackRate * 100).toFixed(0) + '%' : '—',
          'Avg callback', 'Target ≤15%',
          (summary.avgCallbackRate ?? 0) > 0.15 ? '#EF4444' : '#22C55E'
        )}
        {kpiTile(
          summary.avgReliability ? (summary.avgReliability * 100).toFixed(0) + '%' : '—',
          'Avg reliability', 'Target 90%',
          (summary.avgReliability ?? 0) >= 0.90 ? '#22C55E' : '#F59E0B'
        )}
        {kpiTile(
          <>{summary.aboveTarget}<span style={{ fontSize: 14, fontWeight: 400, color: TEXT_MUTED }}>/{summary.activeTechs}</span></>,
          'Above target', '≥90% score',
          ACCENT
        )}
      </div>

      {/* Office + Team breakdown side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        {/* Office breakdown */}
        <div style={card}>
          <div style={cardHead}>By office</div>
          <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px' }}>
            {officeBreakdown.map((o: any) => {
              const sc = scoreColors(o.avgScore);
              return (
                <div key={o.office} style={{
                  flex: 1, background: o.avgScore ? sc.bg : BG_TILE,
                  borderRadius: 8, padding: '10px 12px', textAlign: 'center',
                  border: `0.5px solid ${BORDER}`,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: TEXT_SECONDARY, marginBottom: 4, letterSpacing: '0.04em' }}>{o.office}</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: o.avgScore ? sc.text : TEXT_MUTED }}>
                    {o.avgScore ? (o.avgScore * 100).toFixed(1) + '%' : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 2 }}>{o.techCount} techs</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Team breakdown */}
        <div style={card}>
          <div style={cardHead}>By team</div>
          <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px' }}>
            {teamBreakdown.map((t: any) => {
              const tc = TEAM_COLORS[t.team as keyof typeof TEAM_COLORS];
              const sc = scoreColors(t.avgScore);
              const labels: Record<string, string> = { WP: 'Wildlife', PMP: 'Pest', IP: 'Insulation' };
              return (
                <div key={t.team} style={{
                  flex: 1, background: tc?.bg || BG_TILE,
                  borderRadius: 8, padding: '10px 12px', textAlign: 'center',
                  border: `0.5px solid ${tc?.border || BORDER}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: tc?.text, marginBottom: 1, letterSpacing: '0.04em' }}>{t.team}</div>
                  <div style={{ fontSize: 10, color: tc?.text, opacity: 0.7, marginBottom: 4 }}>{labels[t.team]}</div>
                  <div style={{ fontSize: 24, fontWeight: 500, color: t.avgScore ? sc.text : TEXT_MUTED }}>
                    {t.avgScore ? (t.avgScore * 100).toFixed(1) + '%' : '—'}
                  </div>
                  <div style={{ fontSize: 10, color: TEXT_MUTED, marginTop: 2 }}>{t.techCount} active</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top performers */}
      <div style={card}>
        <div style={cardHead}>Top performers this week</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 32 }}>#</th>
                <SortableTh sortKey="name" sort={sort} style={{ width: 150 }}>Name</SortableTh>
                <SortableTh sortKey="team" sort={sort} style={{ width: 52 }}>Team</SortableTh>
                <SortableTh sortKey="office" sort={sort} style={{ width: 55 }}>Office</SortableTh>
                <SortableTh sortKey="score" sort={sort} style={{ width: 110 }}>Score</SortableTh>
                <SortableTh sortKey="co" sort={sort} style={{ width: 60 }}>CO%</SortableTh>
                <SortableTh sortKey="cb" sort={sort} style={{ width: 65 }}>CB rate</SortableTh>
                <SortableTh sortKey="driving" sort={sort} style={{ width: 65 }}>Driving</SortableTh>
                <SortableTh sortKey="reliability" sort={sort} style={{ width: 72 }}>Reliability</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortedPerformers.length === 0 ? (
                <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: TEXT_MUTED, padding: 32 }}>No scores recorded for this week yet.</td></tr>
              ) : sortedPerformers.map((t: any, i: number) => (
                <tr key={t.techId}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#F8F7F4'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, color: TEXT_MUTED, fontSize: 11, fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</td>
                  <td style={td}>{teamPill(t.team)}</td>
                  <td style={{ ...td, fontSize: 12 }}>{t.office}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {scoreBar(t.score)}
                      {scoreBadge(t.score)}
                    </div>
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>{t.closeOutPct !== null ? (t.closeOutPct * 100).toFixed(0) + '%' : '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{t.callbackRate !== null ? (t.callbackRate * 100).toFixed(0) + '%' : '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{t.drivingScore !== null ? (t.drivingScore * 100).toFixed(0) + '%' : '—'}</td>
                  <td style={{ ...td, fontSize: 12 }}>{t.reliabilityScore !== null ? (t.reliabilityScore * 100).toFixed(0) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
