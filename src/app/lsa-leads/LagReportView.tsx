'use client';
import { useEffect, useState } from 'react';

type Buckets = { '<5m': number; '5-15m': number; '15-60m': number; '1-24h': number; '>1d': number; noReply?: number; total: number };
type Period = { key: string; label: string; firstReply: Buckets; depth: Buckets };
type Seg = 'All' | 'Wildlife' | 'Pest';

// Chisam's Sept-2026 buckets, in order.
const BK: (keyof Buckets)[] = ['<5m', '5-15m', '15-60m', '1-24h', '>1d'];
const BK_LABEL: Record<string, string> = { '<5m': '<5 min', '5-15m': '5-15 min', '15-60m': '15-60 min', '1-24h': '1-24 hr', '>1d': '>1 day' };

const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';

export default function LagReportView({ location }: { location: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [seg, setSeg] = useState<Seg>('All');
  const [metric, setMetric] = useState<'firstReply' | 'depth'>('firstReply');

  useEffect(() => {
    fetch(`/api/lsa-lag-report?location=${encodeURIComponent(location)}`).then(r => r.json()).then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, [location]);

  const periods: Period[] = data ? (view === 'month' ? data.monthly : data.weekly)[seg] || [] : [];

  async function downloadExcel() {
    // SheetJS from CDN (client-side) to build a multi-tab workbook matching Chisam's format.
    const XLSX = await import(/* webpackIgnore: true */ 'https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs' as any);
    const wb = XLSX.utils.book_new();

    const buildSheet = (rows: Period[], m: 'firstReply' | 'depth') => {
      const header = m === 'firstReply'
        ? ['Period', '<5 min', '<5 min %', '5-15 min', '5-15 min %', '>15 min', '>15 min %',
           '>1 day', '>1 day %', 'No Reply', 'No Reply %', 'Total']
        : ['Period', ...BK.map(k => BK_LABEL[k]), 'Total', ...BK.map(k => `${BK_LABEL[k]} %`), '<15m %', '>1d %'];
      const aoa: any[][] = [header];
      const tot: any = { '<5m': 0, '5-15m': 0, '15-60m': 0, '1-24h': 0, '>1d': 0, noReply: 0, total: 0 };
      for (const p of rows) {
        const b = p[m];
        for (const k of [...BK, 'total'] as string[]) tot[k] += (b as any)[k] || 0;
        tot.noReply += b.noReply || 0;
        if (m === 'firstReply') {
          const over15 = b['15-60m'] + b['1-24h'];
          aoa.push([p.label,
            b['<5m'], +(b['<5m'] / b.total || 0),
            b['5-15m'], +(b['5-15m'] / b.total || 0),
            over15, +(over15 / b.total || 0),
            b['>1d'], +(b['>1d'] / b.total || 0),
            b.noReply || 0, +((b.noReply || 0) / b.total || 0),
            b.total]);
        } else {
          const pcts = BK.map(k => +((b as any)[k] / b.total || 0));
          const under15 = ((b['<5m'] + b['5-15m']) / b.total) || 0;
          const over1d = (b['>1d'] / b.total) || 0;
          aoa.push([p.label, ...BK.map(k => (b as any)[k]), b.total, ...pcts, +under15, +over1d]);
        }
      }
      // TOTAL row
      if (m === 'firstReply') {
        const over15 = tot['15-60m'] + tot['1-24h'];
        aoa.push(['TOTAL',
          tot['<5m'], +(tot['<5m'] / tot.total || 0),
          tot['5-15m'], +(tot['5-15m'] / tot.total || 0),
          over15, +(over15 / tot.total || 0),
          tot['>1d'], +(tot['>1d'] / tot.total || 0),
          tot.noReply, +(tot.noReply / tot.total || 0),
          tot.total]);
      } else {
        const totPcts = BK.map(k => +(tot[k] / tot.total || 0));
        aoa.push(['TOTAL', ...BK.map(k => tot[k]), tot.total, ...totPcts,
          +((tot['<5m'] + tot['5-15m']) / tot.total || 0), +(tot['>1d'] / tot.total || 0)]);
      }
      return XLSX.utils.aoa_to_sheet(aoa);
    };

    for (const s of ['All', 'Wildlife', 'Pest'] as Seg[]) {
      const monthRows = data.monthly[s] || [];
      XLSX.utils.book_append_sheet(wb, buildSheet(monthRows, 'firstReply'), `${s} - Reply Time (Mo)`.slice(0, 31));
      XLSX.utils.book_append_sheet(wb, buildSheet(monthRows, 'depth'), `${s} - Follow-up (Mo)`.slice(0, 31));
    }
    // Method note tab
    const note = XLSX.utils.aoa_to_sheet([
      ['LSA Lag Report — Method & Definitions'],
      [''],
      ['Source: live Google LSA message-level data (LocalServicesLead + LocalServicesLeadConversation).'],
      ['This measures follow-up accurately, unlike the July 2026 CSV export (which relied on Google\u2019s'],
      ['"last activity" field — a system default that sat 78.8% of leads at exactly 1 day).'],
      [''],
      ['Metric 1 — TIME TO FIRST REPLY: our first outbound (ADVERTISER) message minus lead received.'],
      ['   "How fast did we engage?" Lower buckets = better. "No reply" = we never responded.'],
      ['Metric 2 — FOLLOW-UP DEPTH: last activity minus lead received (Chisam\u2019s original proxy, computed'],
      ['   from the real conversation). Higher buckets = threads that stayed alive past first contact.'],
      [''],
      ['Buckets (time to respond): <5 min, 5-15 min, 15-60 min, 1-24 hr, >1 day, No Reply.'],
      ['Segments: Wildlife = Job type "Rodents"; Pest = everything else. Message leads only.'],
      ['Percentages are row-wise (bucket / that period\u2019s total).'],
      [`Generated: ${new Date().toLocaleString()}`],
    ]);
    XLSX.utils.book_append_sheet(wb, note, 'Method');

    XLSX.writeFile(wb, `LSA_Lag_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const th: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 11, fontWeight: 500, color: '#888780', borderBottom: '0.5px solid #E8E7E3', whiteSpace: 'nowrap' };
  const thL: React.CSSProperties = { ...th, textAlign: 'left' };
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 12px', fontSize: 13, color: '#2C2C2A', borderBottom: '0.5px solid #F1EFE8', whiteSpace: 'nowrap' };
  const tdL: React.CSSProperties = { ...td, textAlign: 'left', fontWeight: 500 };

  const isFR = metric === 'firstReply';

  // Totals for the highlight strip
  const totals = periods.reduce((a, p) => {
    const b = p[metric];
    for (const k of BK) (a as any)[k] += (b as any)[k];
    a.noReply += b.noReply || 0; a.total += b.total;
    return a;
  }, { '<5m': 0, '5-15m': 0, '15-60m': 0, '1-24h': 0, '>1d': 0, noReply: 0, total: 0 } as any);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
        <p style={{ fontSize: 12, color: '#888780', margin: 0, maxWidth: 620 }}>
          Follow-up responsiveness on this location&apos;s LSA message leads, from real message-level data:
          how fast we send the first reply, and how long threads stay active.
        </p>
        <button onClick={downloadExcel} disabled={!data}
          style={{ fontSize: 13, fontWeight: 500, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #2C2C2A', background: '#2C2C2A', color: '#fff', cursor: data ? 'pointer' : 'default' }}>
          ↓ Download Excel
        </button>
      </div>

      {/* Metric selector — the two clearly-labeled measures */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => setMetric('firstReply')}
          style={{ flex: 1, textAlign: 'left', padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
            background: isFR ? '#eef4ff' : '#fff', border: `0.5px solid ${isFR ? '#0052cc' : '#E8E7E3'}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: isFR ? '#0052cc' : '#2C2C2A' }}>Time to First Reply</div>
          <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>How fast we engaged. Faster = better.</div>
        </button>
        <button onClick={() => setMetric('depth')}
          style={{ flex: 1, textAlign: 'left', padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
            background: !isFR ? '#fef9e6' : '#fff', border: `0.5px solid ${!isFR ? '#a16207' : '#E8E7E3'}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: !isFR ? '#a16207' : '#2C2C2A' }}>Follow-up Depth (Last-Activity Lag)</div>
          <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>Chisam&apos;s original proxy, computed accurately. Longer = sustained follow-up.</div>
        </button>
      </div>

      {/* View + segment controls */}
      <div style={{ display: 'flex', gap: 16, marginTop: 16, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3 }}>
          {(['month', 'week'] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: view === v ? '#fff' : 'transparent', color: view === v ? '#2C2C2A' : '#888780', fontWeight: view === v ? 600 : 400 }}>
              {v === 'month' ? 'Monthly' : 'Weekly'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, background: '#f1efe8', borderRadius: 8, padding: 3 }}>
          {(['All', 'Wildlife', 'Pest'] as Seg[]).map(s => (
            <button key={s} onClick={() => setSeg(s)}
              style={{ fontSize: 12, padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: seg === s ? '#fff' : 'transparent', color: seg === s ? '#2C2C2A' : '#888780', fontWeight: seg === s ? 600 : 400 }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p style={{ color: '#888780', fontSize: 13, padding: 30, textAlign: 'center' }}>Loading…</p>
      ) : periods.length === 0 ? (
        <p style={{ color: '#888780', fontSize: 13, padding: 30, textAlign: 'center' }}>No message-lead data yet. Run the LSA sync first.</p>
      ) : (
        <div style={{ border: '0.5px solid #E8E7E3', borderRadius: 12, overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            {isFR ? (
              // FIRST-REPLY view: lead with the 3 efficiency KPIs as %, keep >1d + No Reply as worst-case flags.
              // The 3 KPIs + >1d + No Reply partition the leads (sum to 100%). ">15m" = 15min-to-1day (excludes >1d).
              <>
                <thead><tr>
                  <th style={thL}>{view === 'month' ? 'Month' : 'Week'}</th>
                  <th style={th}>&lt;5 min</th>
                  <th style={th}>5-15 min</th>
                  <th style={th}>&gt;15 min</th>
                  <th style={{ ...th, borderLeft: '0.5px solid #E8E7E3', color: '#888' }}>&gt;1 day</th>
                  <th style={{ ...th, color: '#888' }}>No Reply</th>
                  <th style={th}>Total</th>
                </tr></thead>
                <tbody>
                  {periods.map(p => {
                    const b = p.firstReply;
                    const over15 = b['15-60m'] + b['1-24h']; // >15 min but replied within a day
                    return (
                      <tr key={p.key}>
                        <td style={tdL}>{p.label}</td>
                        <td style={{ ...td, fontWeight: 600, color: '#128a3f' }}>{b['<5m']} <span style={{ color: '#6b8f79', fontWeight: 500 }}>({pct(b['<5m'], b.total)})</span></td>
                        <td style={{ ...td, fontWeight: 500 }}>{b['5-15m']} <span style={{ color: '#B4B2A9' }}>({pct(b['5-15m'], b.total)})</span></td>
                        <td style={{ ...td, color: '#b45309' }}>{over15} <span style={{ color: '#c99a63' }}>({pct(over15, b.total)})</span></td>
                        <td style={{ ...td, borderLeft: '0.5px solid #E8E7E3', color: '#888' }}>{b['>1d']} <span style={{ color: '#aaa' }}>({pct(b['>1d'], b.total)})</span></td>
                        <td style={{ ...td, color: (b.noReply || 0) > 0 ? '#b91c1c' : '#888' }}>{b.noReply || 0} <span style={{ color: '#aaa' }}>({pct(b.noReply || 0, b.total)})</span></td>
                        <td style={{ ...td, fontWeight: 500 }}>{b.total}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#faf9f6' }}>
                    <td style={{ ...tdL, fontWeight: 600 }}>TOTAL</td>
                    <td style={{ ...td, fontWeight: 700, color: '#128a3f' }}>{totals['<5m']} <span style={{ fontWeight: 500 }}>({pct(totals['<5m'], totals.total)})</span></td>
                    <td style={{ ...td, fontWeight: 600 }}>{totals['5-15m']} <span style={{ fontWeight: 500 }}>({pct(totals['5-15m'], totals.total)})</span></td>
                    <td style={{ ...td, fontWeight: 600, color: '#b45309' }}>{totals['15-60m'] + totals['1-24h']} <span style={{ fontWeight: 500 }}>({pct(totals['15-60m'] + totals['1-24h'], totals.total)})</span></td>
                    <td style={{ ...td, fontWeight: 600, borderLeft: '0.5px solid #E8E7E3', color: '#888' }}>{totals['>1d']} <span style={{ fontWeight: 500 }}>({pct(totals['>1d'], totals.total)})</span></td>
                    <td style={{ ...td, fontWeight: 600, color: totals.noReply > 0 ? '#b91c1c' : '#888' }}>{totals.noReply} <span style={{ fontWeight: 500 }}>({pct(totals.noReply, totals.total)})</span></td>
                    <td style={{ ...td, fontWeight: 600 }}>{totals.total}</td>
                  </tr>
                </tbody>
              </>
            ) : (
              // DEPTH view: unchanged 5-bucket layout.
              <>
                <thead><tr>
                  <th style={thL}>{view === 'month' ? 'Month' : 'Week'}</th>
                  {BK.map(k => <th key={k} style={th}>{BK_LABEL[k]}</th>)}
                  <th style={th}>Total</th>
                  <th style={{ ...th, borderLeft: '0.5px solid #E8E7E3' }}>&gt;1 day %</th>
                </tr></thead>
                <tbody>
                  {periods.map(p => {
                    const b = p.depth;
                    return (
                      <tr key={p.key}>
                        <td style={tdL}>{p.label}</td>
                        {BK.map(k => <td key={k} style={td}>{(b as any)[k]}</td>)}
                        <td style={{ ...td, fontWeight: 500 }}>{b.total}</td>
                        <td style={{ ...td, borderLeft: '0.5px solid #E8E7E3', color: '#128a3f' }}>{pct(b['>1d'], b.total)}</td>
                      </tr>
                    );
                  })}
                  <tr style={{ background: '#faf9f6' }}>
                    <td style={{ ...tdL, fontWeight: 600 }}>TOTAL</td>
                    {BK.map(k => <td key={k} style={{ ...td, fontWeight: 600 }}>{totals[k]}</td>)}
                    <td style={{ ...td, fontWeight: 600 }}>{totals.total}</td>
                    <td style={{ ...td, fontWeight: 600, borderLeft: '0.5px solid #E8E7E3', color: '#128a3f' }}>{pct(totals['>1d'], totals.total)}</td>
                  </tr>
                </tbody>
              </>
            )}
          </table>
        </div>
      )}

      <p style={{ fontSize: 11, color: '#B4B2A9', marginTop: 12, maxWidth: 720 }}>
        {isFR
          ? 'Time to first reply = our first outbound message minus when the lead arrived. Efficiency KPIs: under 5 min (target), 5-15 min, over 15 min (15 min to 1 day). Over 1 day and No reply are kept as worst-case flags, not the main efficiency metric. All five buckets sum to 100%.'
          : 'Follow-up depth = last activity minus lead received, matching Chisam\u2019s original proxy but from real message data. A higher 3+ day share means more threads stayed alive past the first exchange.'}
      </p>
    </div>
  );
}
