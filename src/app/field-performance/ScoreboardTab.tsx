'use client';
import { useEffect, useState } from 'react';
import { scoreBadge, scoreBar, teamPill, pctFmt, kpiCard, card, cardHead, th, td } from './helpers';

interface Props { office: string; weekEnd: Date; }

export function ScoreboardTab({ office, weekEnd }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const wk = weekEnd.toLocaleDateString('en-CA');
    fetch(`/api/field-performance/scoreboard?week=${wk}&office=${office}`)
      .then(r => r.json())
      .then(d => { if (d.error) { setError(d.error); setLoading(false); } else { setData(d); setLoading(false); } })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [office, weekEnd]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#e24b4a' }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No data for this week yet.</div>;

  const { summary, officeBreakdown, teamBreakdown, topPerformers } = data;

  return (
    <div>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginBottom: 10 }}>
        {kpiCard(summary.avgScore ? (summary.avgScore * 100).toFixed(1) + '%' : '—', 'Company avg', 'Target ≥90%', (summary.avgScore ?? 0) >= 0.90 ? '#27500A' : (summary.avgScore ?? 0) >= 0.75 ? '#633806' : '#791F1F')}
        {kpiCard(summary.activeTechs ?? 0, 'Active techs', 'WP · PMP · IP')}
        {kpiCard(summary.avgCloseOutPct ? (summary.avgCloseOutPct * 100).toFixed(0) + '%' : '—', 'Avg CO%', 'Target 85%')}
        {kpiCard(summary.avgCallbackRate ? (summary.avgCallbackRate * 100).toFixed(0) + '%' : '—', 'Avg CB rate', 'Target ≤15%', (summary.avgCallbackRate ?? 0) > 0.15 ? '#854F0B' : undefined)}
        {kpiCard(summary.avgReliability ? (summary.avgReliability * 100).toFixed(0) + '%' : '—', 'Avg reliability', 'Target 90%', (summary.avgReliability ?? 0) >= 0.90 ? '#27500A' : undefined)}
        {kpiCard(<>{summary.aboveTarget}<span style={{ fontSize: 13, fontWeight: 400, color: '#94a3b8' }}>/{summary.activeTechs}</span></>, 'Above target', '≥90% score')}
      </div>

      {/* Office breakdown */}
      <div style={{ ...card }}>
        <div style={cardHead}>Office breakdown</div>
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px' }}>
          {officeBreakdown.map((o: any) => (
            <div key={o.office} style={{ flex: 1, background: '#f8fafc', borderRadius: 8, padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#64748b', marginBottom: 5 }}>{o.office}</div>
              <div style={{ fontSize: 22, fontWeight: 500, color: (o.avgScore ?? 0) >= 0.90 ? '#27500A' : (o.avgScore ?? 0) >= 0.75 ? '#633806' : o.avgScore ? '#791F1F' : '#94a3b8' }}>
                {o.avgScore ? (o.avgScore * 100).toFixed(1) + '%' : '—'}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{o.techCount} techs</div>
            </div>
          ))}
        </div>
      </div>

      {/* Team breakdown */}
      <div style={{ ...card }}>
        <div style={cardHead}>Team breakdown</div>
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 14px' }}>
          {teamBreakdown.map((t: any) => {
            const labelColors: Record<string, string> = { WP: '#0C447C', PMP: '#085041', IP: '#72243E' };
            const labels: Record<string, string> = { WP: 'WP — Wildlife', PMP: 'PMP — Pest', IP: 'IP — Insulation' };
            return (
              <div key={t.team} style={{ flex: 1, background: '#f8fafc', borderRadius: 8, padding: 12, textAlign: 'center' }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: labelColors[t.team], marginBottom: 5 }}>{labels[t.team]}</div>
                <div style={{ fontSize: 22, fontWeight: 500, color: (t.avgScore ?? 0) >= 0.90 ? '#27500A' : (t.avgScore ?? 0) >= 0.75 ? '#633806' : t.avgScore ? '#791F1F' : '#94a3b8' }}>
                  {t.avgScore ? (t.avgScore * 100).toFixed(1) + '%' : '—'}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{t.techCount} active</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top performers */}
      <div style={card}>
        <div style={cardHead}>Top performers this week</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 140 }}>Name</th>
                <th style={{ ...th, width: 52 }}>Team</th>
                <th style={{ ...th, width: 55 }}>Office</th>
                <th style={{ ...th, width: 100 }}>Score</th>
                <th style={{ ...th, width: 58 }}>CO%</th>
                <th style={{ ...th, width: 65 }}>CB rate</th>
                <th style={{ ...th, width: 65 }}>Driving</th>
                <th style={{ ...th, width: 72 }}>Reliability</th>
              </tr>
            </thead>
            <tbody>
              {topPerformers.length === 0 ? (
                <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>No scores recorded for this week yet.</td></tr>
              ) : topPerformers.map((t: any) => (
                <tr key={t.techId} style={{ cursor: 'default' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</td>
                  <td style={td}>{teamPill(t.team)}</td>
                  <td style={td}>{t.office}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {scoreBar(t.score)}
                      {scoreBadge(t.score)}
                    </div>
                  </td>
                  <td style={td}>{t.closeOutPct !== null ? (t.closeOutPct * 100).toFixed(0) + '%' : '—'}</td>
                  <td style={td}>{t.callbackRate !== null ? (t.callbackRate * 100).toFixed(0) + '%' : '—'}</td>
                  <td style={td}>{t.drivingScore !== null ? (t.drivingScore * 100).toFixed(0) + '%' : '—'}</td>
                  <td style={td}>{t.reliabilityScore !== null ? (t.reliabilityScore * 100).toFixed(0) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
