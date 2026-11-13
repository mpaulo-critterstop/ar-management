'use client';
export const dynamic = 'force-dynamic';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader as CCPageHeader } from '@/components/cc/Layout';

const money = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const money2 = (n: number) => '$' + (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Last 10 Mondays + last 4 months, as selectable period options.
function periodOptions() {
  const weeks: { key: string; label: string }[] = [];
  const d = new Date(); const dow = d.getUTCDay(); const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() + diff);
  // All Mondays from the week containing Aug 1 2026 up to the current week (newest first).
  const firstMon = new Date(Date.UTC(2026, 7, 1)); // Aug 1
  const fdow = firstMon.getUTCDay(); firstMon.setUTCDate(firstMon.getUTCDate() + (fdow === 0 ? -6 : 1 - fdow));
  for (let w = new Date(mon); w >= firstMon; w.setUTCDate(w.getUTCDate() - 7)) {
    const k = w.toISOString().slice(0, 10);
    weeks.push({ key: k, label: `Wk of ${w.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` });
  }
  // Months from Aug 2026 up to current month (newest first).
  const months: { key: string; label: string }[] = [];
  const startM = new Date(Date.UTC(2026, 7, 1)); // Aug 2026
  for (let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); m >= startM; m.setUTCMonth(m.getUTCMonth() - 1)) {
    months.push({ key: m.toISOString().slice(0, 10), label: m.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
  }
  return { weeks, months };
}

export default function ExclusionRevenueReport() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pm' | 'fp' | 'jobs'>('pm');
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const [office, setOffice] = useState('DFW');
  const [date, setDate] = useState('');
  const opts = periodOptions();
  const period = 'month';

  const qs = () => `&period=month&date=${date || opts.months[0].key}&office=${office}`;

  const load = () => {
    setLoading(true);
    fetch(`/api/cron/exclusion-revenue?token=critterstop2026&detail=1${qs()}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(load, [period, date, office]);

  const refresh = async () => {
    setRefreshing(true); setStatus(`Starting…`);
    await fetch(`/api/cron/exclusion-revenue?token=critterstop2026&refresh=1${qs()}`).catch(() => {});
    const poll = setInterval(async () => {
      const s = await fetch('/api/cron/exclusion-revenue?token=critterstop2026&status=1').then(r => r.json()).catch(() => ({}));
      setStatus(s.status || '');
      if ((s.status || '').startsWith('done') || (s.status || '').startsWith('ERROR')) { clearInterval(poll); setRefreshing(false); load(); }
    }, 5000);
  };

  const t = data?.totals;
  const th: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontSize: 11, fontWeight: 600, color: '#908E85', borderBottom: '0.5px solid #2A2A30', whiteSpace: 'nowrap', background: '#1C1C21', position: 'sticky', top: 0 };
  const td: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontSize: 13, borderBottom: '0.5px solid #232329', whiteSpace: 'nowrap' };
  const tdL = { ...td, textAlign: 'left' as const };
  const tile = (label: string, value: string, color: string, bg: string, note?: string) => (
    <div style={{ border: `0.5px solid ${bg}`, borderRadius: 10, padding: '12px 16px', background: bg === '#2A2A30' ? '#1C1C21' : bg + '20', minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#908E85', marginTop: 2 }}>{label}</div>
      {note && <div style={{ fontSize: 10, color: color, marginTop: 2 }}>{note}</div>}
    </div>
  );

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '30px 34px 70px' }}>
      <Link href="/reports" style={{ fontSize: 13, color: '#908E85', textDecoration: 'none' }}>↩ Reports</Link>
      <div style={{ marginTop: 6 }}><CCPageHeader icon="🪜" title="Exclusion Productivity" /></div>
      <p style={{ fontSize: 13, color: '#908E85', margin: '0 0 16px', lineHeight: 1.6 }}>
        Revenue generated per scheduled tech-hour vs. the standard (<b>$225/hr 1-story, $175/hr 2-story</b>). Exclusion revenue = base service charge only (trapping, fogging, insulation excluded). Based on scheduled durations.
      </p>

      {/* Controls — always visible, so uncomputed periods can still be run */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <select value={office} onChange={e => setOffice(e.target.value)} style={{ fontSize: 13, padding: '6px 10px', borderRadius: 7, border: '0.5px solid #2A2A30' }}>
            {['DFW', 'ATX', 'OKC', 'CStat'].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <select value={date || opts.months[0].key} onChange={e => setDate(e.target.value)} style={{ fontSize: 13, padding: '6px 10px', borderRadius: 7, border: '0.5px solid #2A2A30' }}>
            {opts.months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <button onClick={refresh} disabled={refreshing} style={{ fontSize: 12, padding: '6px 14px', borderRadius: 7, border: 'none', background: refreshing ? '#232329' : '#5B9BE0', color: refreshing ? '#908E85' : '#1C1C21', cursor: refreshing ? 'default' : 'pointer' }}>{refreshing ? '⏳ Computing…' : '↻ Refresh this period'}</button>
          {refreshing && <span style={{ fontSize: 11, color: '#5B9BE0', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{status}</span>}
          <a href={`/api/cron/exclusion-revenue?token=critterstop2026&csv=1&view=${tab === 'jobs' ? 'jobs' : tab === 'pm' ? 'pm' : 'fp'}${qs()}`} style={{ fontSize: 12, padding: '6px 12px', borderRadius: 7, background: '#43B892', color: '#fff', textDecoration: 'none', marginLeft: 'auto' }}>⬇ CSV (this tab)</a>
      </div>

      {loading && <div style={{ fontSize: 14, color: '#908E85', padding: 20 }}>Loading…</div>}

      {!loading && !t && (
        <div style={{ fontSize: 14, color: '#908E85', padding: 20, background: '#232329', borderRadius: 10 }}>
          This period hasn't been computed yet. Click <b>↻ Refresh this period</b> above to run it (takes ~1–2 min).
        </div>
      )}

      {t && (<>
        <div style={{ fontSize: 12, color: '#63615A', marginBottom: 10 }}>
          {data.label || `${data.from} → ${data.to}`} · {data.offices?.join(', ')} · {t.exclusionJobs} jobs ({t.jobsTagged} story-tagged) · computed {data.computedAt ? new Date(data.computedAt).toLocaleString() : '—'}
        </div>

        {/* Summary tiles */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {tile('Exclusion revenue', money(t.totalExclusionRevenue), '#F0EEE8', '#2A2A30')}
          {tile('1-story $/tech-hr', money(t.oneStoryBlendedRate), t.oneStoryBlendedRate > 225 ? '#DBA14E' : '#43B892', '#2A2A30', `std $225 · ${t.oneStoryJobs} jobs`)}
          {tile('2-story $/tech-hr', money(t.twoStoryBlendedRate), t.twoStoryBlendedRate > 175 ? '#E57C7C' : '#43B892', '#2A2A30', `std $175 · ${t.twoStoryJobs} jobs`)}
          {tile('Scheduling shortfall', `${t.varianceHours > 0 ? '+' : ''}${Math.round(t.varianceHours).toLocaleString()} hrs`, t.varianceHours > 0 ? '#E57C7C' : '#43B892', '#2A2A30', t.varianceHours > 0 ? 'under-allotted' : 'over-allotted')}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {([['pm', 'PM Scheduling'], ['fp', 'By Field Professional'], ['jobs', 'Job Detail']] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} style={{ fontSize: 13, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: tab === k ? 600 : 400, background: tab === k ? '#5B9BE0' : '#232329', color: tab === k ? '#1C1C21' : '#C9C7BF' }}>{lbl}</button>
          ))}
        </div>

        <div style={{ border: '0.5px solid #2A2A30', borderRadius: 12, overflow: 'hidden', background: '#1C1C21' }}>
          <div style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
            {tab === 'pm' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>PM (Scheduler)</th><th style={th}>Jobs</th><th style={{ ...th, textAlign: 'right' }}>Excl Rev</th><th style={th}>Sched Tech-Hrs</th><th style={th}>Expected Hrs</th><th style={th}>Variance</th><th style={th}>Avg $/Tech-Hr</th><th style={th}>1-Story $/Hr</th><th style={th}>2-Story $/Hr</th><th style={th}>Differentiation</th>
                </tr></thead>
                <tbody>
                  {(data.byPM || []).map((r: any, i: number) => (
                    <tr key={i} style={{ background: i % 2 ? '#232329' : undefined }}>
                      <td style={tdL}>{r.pm}</td>
                      <td style={td}>{r.jobs}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(r.exclusionRevenue)}</td>
                      <td style={td}>{r.schedTechHours}</td>
                      <td style={td}>{r.expectedTechHours ?? '—'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.varianceHours > 0.5 ? '#E57C7C' : (r.varianceHours < -0.5 ? '#DBA14E' : '#908E85') }} title="Expected − Scheduled tech-hours. + = scheduled less than revenue justifies; − = scheduled more.">{r.varianceHours != null ? `${r.varianceHours > 0 ? '+' : ''}${r.varianceHours}` : '—'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{money(r.avgRevPerSchedTechHour)}</td>
                      <td style={td}>{r.oneStoryJobs ? money(r.oneStoryRate) : '—'}</td>
                      <td style={td}>{r.twoStoryJobs ? money(r.twoStoryRate) : '—'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.differentiation == null ? '#908E85' : (r.differentiation > 5 ? '#43B892' : '#E57C7C') }} title="1-story should run a higher $/hr than 2-story (less time). Positive = PM gives 2-story more time (good). ~0 or negative = not differentiating.">{r.differentiation == null ? '—' : `${r.differentiation > 0 ? '+' : ''}$${r.differentiation}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : tab === 'fp' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Field Professional</th><th style={th}>Jobs</th><th style={{ ...th, textAlign: 'right' }}>Exclusion Rev</th><th style={th}>Sched Tech-Hrs</th><th style={th}>Expected Hrs</th><th style={th}>Variance</th><th style={th}>$/Tech-Hr</th><th style={{ ...th, textAlign: 'right' }}>Trapping</th><th style={{ ...th, textAlign: 'right' }}>Fogging</th>
                </tr></thead>
                <tbody>
                  {(data.rows || []).map((r: any, i: number) => (
                    <tr key={i} style={{ background: i % 2 ? '#232329' : undefined }}>
                      <td style={tdL}>{r.fieldProfessional}</td>
                      <td style={td}>{r.jobs}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(r.exclusionRevenue)}</td>
                      <td style={td}>{r.scheduledHours}</td>
                      <td style={td}>{r.expectedHours ?? '—'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.varianceHours > 0.5 ? '#E57C7C' : (r.varianceHours < -0.5 ? '#DBA14E' : '#908E85') }} title="Expected − Scheduled tech-hours for this FP's share of jobs.">{r.varianceHours != null ? `${r.varianceHours > 0 ? '+' : ''}${r.varianceHours}` : '—'}</td>
                      <td style={{ ...td, fontWeight: 600, color: r.revenuePerSchedTechHour > 225 ? '#DBA14E' : '#F0EEE8' }}>{money(r.revenuePerSchedTechHour)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#908E85' }}>{money(r.trappingRevenue)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#908E85' }}>{money(r.foggingRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Customer</th><th style={{ ...th, textAlign: 'left' }}>PM</th><th style={th}>Stories</th><th style={th}>Rate</th><th style={{ ...th, textAlign: 'right' }}>Excl Rev</th><th style={th}>Crew</th><th style={th}>Sched Tech-Hrs</th><th style={th}>Expected Hrs</th><th style={th}>Variance</th><th style={th}>$/Tech-Hr</th>
                </tr></thead>
                <tbody>
                  {(data.perJob || []).slice().sort((a: any, b: any) => (b.varianceHours ?? -999) - (a.varianceHours ?? -999)).map((j: any, i: number) => (
                    <tr key={i} style={{ background: i % 2 ? '#232329' : undefined }}>
                      <td style={tdL}>{j.customer || j.customerID}</td>
                      <td style={{ ...tdL, color: '#C9C7BF' }}>{j.pm || '—'}</td>
                      <td style={td}>{j.stories || '—'}</td>
                      <td style={td}>{j.rate ? money(j.rate) : '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{money(j.exclusionRevenue)}</td>
                      <td style={{ ...td, fontSize: 11, color: '#908E85', maxWidth: 160, whiteSpace: 'normal' }} title={(j.crew || []).join(', ')}>{j.crewSize || 1}{j.crew && j.crew.length ? ` (${j.crew.slice(0,2).join(', ')}${j.crew.length>2?'…':''})` : ''}</td>
                      <td style={td}>{j.schedTechHours ?? j.schedHours}</td>
                      <td style={td}>{j.expectedTechHours ?? '—'}</td>
                      <td style={{ ...td, fontWeight: 600, color: j.varianceHours > 0.5 ? '#E57C7C' : (j.varianceHours < -0.5 ? '#DBA14E' : '#908E85') }}>{j.varianceHours != null ? `${j.varianceHours > 0 ? '+' : ''}${j.varianceHours}` : '—'}</td>
                      <td style={{ ...td, color: '#C9C7BF' }}>{money(j.revenuePerSchedTechHour)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <p style={{ fontSize: 11, color: '#63615A', lineHeight: 1.6, marginTop: 10 }}>
          Variance = expected tech-hours (revenue ÷ standard rate) − scheduled tech-hours. <b style={{ color: '#E57C7C' }}>+</b> = under-allotted (revenue justifies more time than scheduled); <b style={{ color: '#DBA14E' }}>−</b> = over-allotted. Actual on-site time not used (scheduled durations only). Roof-difficulty tier not yet applied.
        </p>
      </>)}
    </div>
  );
}
