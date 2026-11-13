'use client';
import { useEffect, useState } from 'react';
import { DataTable as CCDataTable, CustomerCell as CCCustomerCell } from '@/components/cc/Layout';
import { scoreBadge, scoreBar, scoreColors, teamPill, kpiTile, card, cardHead, th, td,
  TEAM_COLORS, BG_TILE, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, ACCENT,
  useSort, sortRows, SortableTh , periodParams, type Period } from './helpers';

interface Props { office: string; weekEnd: Date; leaderFilter?: string; period?: Period; }

export function ScoreboardTab({ office, weekEnd, leaderFilter = '', period }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sort = useSort('score', 'desc');

  const periodKey = period?.mode === 'month' ? `m${period.year}-${period.month}` : weekEnd.toLocaleDateString('en-CA');
  useEffect(() => {
    setLoading(true);
    setError(null);
    const pp = periodParams(period ?? { mode: 'week', week: weekEnd });
    fetch(`/api/field-performance/scoreboard?${pp}&office=${office}&leader=${encodeURIComponent(leaderFilter)}`)
      .then(r => r.json())
      .then(d => { if (d.error) { setError(d.error); } else { setData(d); } setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [office, periodKey, leaderFilter]);

  if (loading) return (
    <div style={{ padding: 48, textAlign: 'center', color: TEXT_MUTED }}>
      <div style={{ fontSize: 13, fontWeight: 500 }}>Loading scores...</div>
    </div>
  );
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#E57C7C' }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: TEXT_MUTED }}>No data for this week yet.</div>;

  const { summary, officeBreakdown, teamBreakdown, topPerformers, effortMeters, dfwPestRouteValue, tcFrequency, capacity, standards } = data;
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
          summary.avgCloseOutPct >= 0.85 ? '#43B892' : '#DBA14E'
        )}
        {kpiTile(
          summary.avgCallbackRate ? (summary.avgCallbackRate * 100).toFixed(0) + '%' : '—',
          'Avg callback', 'Target ≤15%',
          (summary.avgCallbackRate ?? 0) > 0.15 ? '#E57C7C' : '#43B892'
        )}
        {kpiTile(
          summary.avgReliability ? (summary.avgReliability * 100).toFixed(0) + '%' : '—',
          'Avg reliability', 'Target 90%',
          (summary.avgReliability ?? 0) >= 0.90 ? '#43B892' : '#DBA14E'
        )}
        {kpiTile(
          <>{summary.aboveTarget}<span style={{ fontSize: 14, fontWeight: 400, color: TEXT_MUTED }}>/{summary.activeTechs}</span></>,
          'Above target', '≥90% score',
          ACCENT
        )}
      </div>

      {/* Excel Scoreboard — Effort Meter averages + TC Frequency + Route Value + Capacity */}
      {effortMeters && (() => {
        const em = (v: number | null) => v != null ? (v * 100).toFixed(1) + '%' : '—';
        const emColor = (v: number | null) => v == null ? BG_TILE : v >= (standards?.effortMeter ?? 0.9) ? '#43B892' : '#DBA14E';
        const emTiles: Array<[string, number | null]> = [
          ['WP Avg. Effort Meter', effortMeters.WP],
          ['IP Avg. Effort Meter', effortMeters.IP],
          ['PMP Avg. Effort Meter', effortMeters.PMP],
          ['DFW Avg. Effort Meter', effortMeters.DFW],
          ['ATX Avg. Effort Meter', effortMeters.ATX],
          ['OKC Avg. Effort Meter', effortMeters.OKC],
          ['CStat Avg. Effort Meter', effortMeters.CStat],
          ['DFW WP & IP Effort Meter', effortMeters.DFW_WP_IP],
          ['DFW PMP Effort Meter', effortMeters.DFW_PMP],
        ];
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
            {kpiTile(
              tcFrequency != null ? tcFrequency.toFixed(1) : '—',
              'TC Frequency', data.tcFrequencyIsFallback ? 'Recent (no wk data)' : `Std ${standards?.tcFrequency ?? 10} days`,
              tcFrequency != null && tcFrequency <= (standards?.tcFrequency ?? 10) ? '#43B892' : '#DBA14E'
            )}
            {emTiles.map(([label, v]) => (
              <div key={label}>{kpiTile(em(v), label, 'Target ≥90%', emColor(v))}</div>
            ))}
            {kpiTile(
              dfwPestRouteValue != null ? '$' + Math.round(dfwPestRouteValue).toLocaleString() : '—',
              'DFW Pest Route Value', 'Avg / route', ACCENT
            )}
            {kpiTile(capacity?.W ?? 0, 'W Capacity', 'Techs worked', TEXT_MUTED)}
            {kpiTile(capacity?.I ?? 0, 'I Capacity Worked', 'Techs worked', TEXT_MUTED)}
            {kpiTile(capacity?.PMP ?? 0, 'PMP Capacity Worked', 'Techs worked', TEXT_MUTED)}
          </div>
        );
      })()}

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
        <CCDataTable
          rowKey={(t: any) => t.techId}
          empty="No scores recorded for this week yet."
          cols={[
            { key: 'name', label: <span onClick={() => sort.set('name')} style={{ cursor: 'pointer' }}>Technician{sort.key==='name'?(sort.dir==='asc'?' ▲':' ▼'):''}</span> as any, render: (t: any) => <CCCustomerCell name={t.name} sub={t.office} /> },
            { key: 'team', label: <span onClick={() => sort.set('team')} style={{ cursor: 'pointer' }}>Team{sort.key==='team'?(sort.dir==='asc'?' ▲':' ▼'):''}</span> as any, render: (t: any) => teamPill(t.team) },
            { key: 'score', label: <span onClick={() => sort.set('score')} style={{ cursor: 'pointer' }}>Total Effort{sort.key==='score'?(sort.dir==='asc'?' ▲':' ▼'):''}</span> as any, render: (t: any) => <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{scoreBar(t.score)}{scoreBadge(t.score)}</div> },
            { key: 'co', label: <span onClick={() => sort.set('co')} style={{ cursor: 'pointer' }}>CO%{sort.key==='co'?(sort.dir==='asc'?' ▲':' ▼'):''}</span> as any, align: 'right', render: (t: any) => <span style={{ fontSize: 12.5, color: '#C9C7BF', fontVariantNumeric: 'tabular-nums' }}>{t.closeOutPct !== null ? (t.closeOutPct * 100).toFixed(0) + '%' : '—'}</span> },
            { key: 'cb', label: <span onClick={() => sort.set('cb')} style={{ cursor: 'pointer' }}>CB rate{sort.key==='cb'?(sort.dir==='asc'?' ▲':' ▼'):''}</span> as any, align: 'right', render: (t: any) => <span style={{ fontSize: 12.5, color: '#C9C7BF', fontVariantNumeric: 'tabular-nums' }}>{t.callbackRate !== null ? (t.callbackRate * 100).toFixed(0) + '%' : '—'}</span> },
            { key: 'driving', label: <span onClick={() => sort.set('driving')} style={{ cursor: 'pointer' }}>Driving{sort.key==='driving'?(sort.dir==='asc'?' ▲':' ▼'):''}</span> as any, align: 'right', render: (t: any) => <span style={{ fontSize: 12.5, color: '#C9C7BF', fontVariantNumeric: 'tabular-nums' }}>{t.drivingScore !== null ? (t.drivingScore * 100).toFixed(0) + '%' : '—'}</span> },
            { key: 'reliability', label: <span onClick={() => sort.set('reliability')} style={{ cursor: 'pointer' }}>Reliability{sort.key==='reliability'?(sort.dir==='asc'?' ▲':' ▼'):''}</span> as any, align: 'right', render: (t: any) => <span style={{ fontSize: 12.5, color: '#C9C7BF', fontVariantNumeric: 'tabular-nums' }}>{t.reliabilityScore !== null ? (t.reliabilityScore * 100).toFixed(0) + '%' : '—'}</span> },
          ]}
          rows={sortedPerformers}
        />
      </div>
    </div>
  );
}
