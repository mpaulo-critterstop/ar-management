'use client';
import { useEffect, useState } from 'react';
import { scoreBadge, card, cardHead, th, td } from './helpers';

interface Props { office: string; weekEnd: Date; }

export function TeamsTab({ office, weekEnd }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const wk = weekEnd.toISOString().split('T')[0];
    fetch(`/api/field-performance/teams?week=${wk}&office=${office}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [office, weekEnd]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No data available.</div>;

  const { crewLeaders, siteLeaders } = data;

  const pct = (v: number | null) => v !== null && v !== undefined ? (v * 100).toFixed(0) + '%' : '—';

  return (
    <div>
      <div style={card}>
        <div style={cardHead}>By crew leader</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 160 }}>Crew leader</th>
                <th style={{ ...th, width: 60 }}>Office</th>
                <th style={{ ...th, width: 55 }}>Techs</th>
                <th style={{ ...th, width: 95 }}>Avg score</th>
                <th style={{ ...th, width: 65 }}>Avg CO%</th>
                <th style={{ ...th, width: 72 }}>Avg CB rate</th>
                <th style={{ ...th, width: 72 }}>Avg driving</th>
              </tr>
            </thead>
            <tbody>
              {crewLeaders.length === 0 ? (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>No data for this week yet.</td></tr>
              ) : crewLeaders.map((c: any) => (
                <tr key={c.leader}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ''}
                >
                  <td style={{ ...td, fontWeight: 500 }}>{c.leader}</td>
                  <td style={td}>{c.office}</td>
                  <td style={td}>{c.techCount}</td>
                  <td style={td}>{scoreBadge(c.avgScore)}</td>
                  <td style={td}>{pct(c.avgCloseOutPct)}</td>
                  <td style={td}>{pct(c.avgCallbackRate)}</td>
                  <td style={td}>{pct(c.avgDriving)}</td>
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
                <th style={{ ...th, width: 160 }}>Site leader</th>
                <th style={{ ...th, width: 60 }}>Office</th>
                <th style={{ ...th, width: 55 }}>Crews</th>
                <th style={{ ...th, width: 55 }}>Techs</th>
                <th style={{ ...th, width: 95 }}>Avg score</th>
                <th style={{ ...th, width: 90 }}>WP avg</th>
                <th style={{ ...th, width: 90 }}>PMP avg</th>
              </tr>
            </thead>
            <tbody>
              {siteLeaders.length === 0 ? (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#94a3b8', padding: 24 }}>No data for this week yet.</td></tr>
              ) : siteLeaders.map((s: any) => (
                <tr key={s.leader}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
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
