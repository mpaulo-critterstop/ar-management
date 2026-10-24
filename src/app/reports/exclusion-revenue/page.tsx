'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const money2 = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ExclusionRevenueReport() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'fp' | 'jobs'>('fp');
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');

  const load = () => {
    setLoading(true);
    fetch('/api/cron/exclusion-revenue?token=critterstop2026&detail=1')
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, []);

  const refresh = async (office: string) => {
    setRefreshing(true); setStatus(`Starting ${office}…`);
    await fetch(`/api/cron/exclusion-revenue?token=critterstop2026&refresh=1&office=${office}&from=2026-08-01&to=2026-10-31`).catch(() => {});
    // poll status
    const poll = setInterval(async () => {
      const s = await fetch('/api/cron/exclusion-revenue?token=critterstop2026&status=1').then(r => r.json()).catch(() => ({}));
      setStatus(s.status || '');
      if ((s.status || '').startsWith('done') || (s.status || '').startsWith('ERROR')) { clearInterval(poll); setRefreshing(false); load(); }
    }, 5000);
  };

  const t = data?.totals;
  const th: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0 };
  const td: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontSize: 13, borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const tdL = { ...td, textAlign: 'left' as const };
  const tile = (label: string, value: string, color: string, bg: string, note?: string) => (
    <div style={{ border: `0.5px solid ${bg}`, borderRadius: 10, padding: '12px 16px', background: bg === '#E8E7E3' ? '#fff' : bg + '20', minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>{label}</div>
      {note && <div style={{ fontSize: 10, color: color, marginTop: 2 }}>{note}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <a href="/reports" style={{ fontSize: 13, color: '#888780', textDecoration: 'none' }}>← Reports</a>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#2C2C2A', margin: '8px 0 4px' }}>🪜 Exclusion Productivity</h1>
      <p style={{ fontSize: 13, color: '#888780', margin: '0 0 16px', lineHeight: 1.6 }}>
        Revenue generated per scheduled tech-hour vs. the standard (<b>$225/hr 1-story, $175/hr 2-story</b>). Exclusion revenue = base service charge only (trapping, fogging, insulation excluded). Based on scheduled durations.
      </p>

      {loading && <div style={{ fontSize: 14, color: '#888780', padding: 20 }}>Loading…</div>}

      {data && !loading && !t && (
        <div style={{ fontSize: 14, color: '#888780', padding: 20, background: '#FBFBF9', borderRadius: 10 }}>
          Not computed yet. Click an office below to run it.
        </div>
      )}

      {t && (<>
        <div style={{ fontSize: 12, color: '#B4B2A9', marginBottom: 10 }}>
          {data.from} → {data.to} · {data.offices?.join(', ')} · {t.exclusionJobs} jobs ({t.jobsTagged} story-tagged) · computed {data.computedAt ? new Date(data.computedAt).toLocaleString() : '—'}
        </div>

        {/* Summary tiles */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {tile('Exclusion revenue', money(t.totalExclusionRevenue), '#2C2C2A', '#E8E7E3')}
          {tile('1-story $/tech-hr', money(t.oneStoryBlendedRate), t.oneStoryBlendedRate > 225 ? '#b45309' : '#1D6E56', '#E8E7E3', `std $225 · ${t.oneStoryJobs} jobs`)}
          {tile('2-story $/tech-hr', money(t.twoStoryBlendedRate), t.twoStoryBlendedRate > 175 ? '#b91c1c' : '#1D6E56', '#E8E7E3', `std $175 · ${t.twoStoryJobs} jobs`)}
          {tile('Scheduling shortfall', `${t.varianceHours > 0 ? '+' : ''}${Math.round(t.varianceHours).toLocaleString()} hrs`, t.varianceHours > 0 ? '#b91c1c' : '#1D6E56', '#E8E7E3', t.varianceHours > 0 ? 'under-allotted' : 'over-allotted')}
        </div>

        {/* Refresh controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#888780' }}>Recompute office:</span>
          {['DFW', 'ATX', 'OKC', 'CStat'].map(o => (
            <button key={o} onClick={() => refresh(o)} disabled={refreshing} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, border: '0.5px solid #D9D9D9', background: refreshing ? '#F1EFE8' : '#fff', cursor: refreshing ? 'default' : 'pointer' }}>{o}</button>
          ))}
          {refreshing && <span style={{ fontSize: 11, color: '#185FA5' }}>⏳ {status}</span>}
          <a href="/api/cron/exclusion-revenue?token=critterstop2026&csv=1" style={{ fontSize: 12, padding: '5px 12px', borderRadius: 7, background: '#128a3f', color: '#fff', textDecoration: 'none', marginLeft: 'auto' }}>⬇ CSV</a>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {([['fp', 'By Field Professional'], ['jobs', 'Job Detail']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: tab === k ? 600 : 400, background: tab === k ? '#1F3864' : '#F1EFE8', color: tab === k ? '#fff' : '#555' }}>{lbl}</button>
          ))}
        </div>

        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
          <div style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
            {tab === 'fp' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Field Professional</th><th style={th}>Jobs</th><th style={{ ...th, textAlign: 'right' }}>Exclusion Rev</th><th style={th}>Sched Tech-Hrs</th><th style={th}>$/Tech-Hr</th><th style={{ ...th, textAlign: 'right' }}>Trapping</th><th style={{ ...th, textAlign: 'right' }}>Fogging</th>
                </tr></thead>
                <tbody>
                  {(data.rows || []).map((r: any, i: number) => (
                    <tr key={i} style={{ background: i % 2 ? '#FBFBF9' : undefined }}>
                      <td style={tdL}>{r.fieldProfessional}</td>
                      <td style={td}>{r.jobs}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(r.exclusionRevenue)}</td>
                      <td style={td}>{r.scheduledHours}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.revenuePerSchedTechHour > 225 ? '#b45309' : '#2C2C2A' }}>{money(r.revenuePerSchedTechHour)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#888780' }}>{money(r.trappingRevenue)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#888780' }}>{money(r.foggingRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Customer</th><th style={th}>Stories</th><th style={th}>Rate</th><th style={{ ...th, textAlign: 'right' }}>Excl Rev</th><th style={th}>Sched Hrs</th><th style={th}>Expected Hrs</th><th style={th}>Variance</th><th style={th}>$/Tech-Hr</th>
                </tr></thead>
                <tbody>
                  {(data.perJob || []).slice().sort((a: any, b: any) => (b.varianceHours ?? -999) - (a.varianceHours ?? -999)).map((j: any, i: number) => (
                    <tr key={i} style={{ background: i % 2 ? '#FBFBF9' : undefined }}>
                      <td style={tdL}>{j.customer || j.customerID}</td>
                      <td style={td}>{j.stories || '—'}</td>
                      <td style={td}>{j.rate ? money(j.rate) : '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(j.exclusionRevenue)}</td>
                      <td style={td}>{j.schedTechHours ?? j.schedHours}</td>
                      <td style={td}>{j.expectedTechHours ?? '—'}</td>
                      <td style={{ ...td, fontWeight: 600, color: j.varianceHours > 0.5 ? '#b91c1c' : (j.varianceHours < -0.5 ? '#b45309' : '#888780') }}>{j.varianceHours != null ? `${j.varianceHours > 0 ? '+' : ''}${j.varianceHours}` : '—'}</td>
                      <td style={{ ...td, color: '#555' }}>{money(j.revenuePerSchedTechHour)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#B4B2A9', lineHeight: 1.6, marginTop: 10 }}>
          Variance = expected tech-hours (revenue ÷ standard rate) − scheduled tech-hours. <b style={{ color: '#b91c1c' }}>+</b> = under-allotted (revenue justifies more time than scheduled); <b style={{ color: '#b45309' }}>−</b> = over-allotted. Actual on-site time not used (scheduled durations only). Roof-difficulty tier not yet applied.
        </p>
      </>)}
    </div>
  );
}
