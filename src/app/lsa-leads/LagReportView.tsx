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
        ? ['Period', ...BK.map(k => BK_LABEL[k]), 'No Reply', 'Total', ...BK.map(k => `${BK_LABEL[k]} %`), 'No Reply %']
        : ['Period', ...BK.map(k => BK_LABEL[k]), 'Total', ...BK.map(k => `${BK_LABEL[k]} %`), '<15m %', '>1d %'];
      const aoa: any[][] = [header];
      const tot: any = { '<5m': 0, '5-15m': 0, '15-60m': 0, '1-24h': 0, '>1d': 0, noReply: 0, total: 0 };
      for (const p of rows) {
        const b = p[m];
        for (const k of [...BK, 'total'] as string[]) tot[k] += (b as any)[k] || 0;
        tot.noReply += b.noReply || 0;
        const pcts = BK.map(k => +((b as any)[k] / b.total || 0));
        if (m === 'firstReply') {
          aoa.push([p.label, ...BK.map(k => (b as any)[k]), b.noReply || 0, b.total, ...pcts, +((b.noReply || 0) / b.total || 0)]);
        } else {
          const under15 = ((b['<5m'] + b['5-15m']) / b.total) || 0;
          const over1d = (b['>1d'] / b.total) || 0;
          aoa.push([p.label, ...BK.map(k => (b as any)[k]), b.total, ...pcts, +under15, +over1d]);
        }
      }
      // TOTAL row
      const totPcts = BK.map(k => +(tot[k] / tot.total || 0));
      if (m === 'firstReply') {
        aoa.push(['TOTAL', ...BK.map(k => tot[k]), tot.noReply, tot.total, ...totPcts, +(tot.noReply / tot.total || 0)]);
      } else {
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
            <thead><tr>
              <th style={thL}>{view === 'month' ? 'Month' : 'Week'}</th>
              {BK.map(k => <th key={k} style={th}>{BK_LABEL[k]}</th>)}
              {isFR && <th style={th}>No Reply</th>}
              <th style={th}>Total</th>
              <th style={{ ...th, borderLeft: '0.5px solid #E8E7E3' }}>{isFR ? '>1d / No-reply %' : '>1 day %'}</th>
            </tr></thead>
            <tbody>
              {periods.map(p => {
                const b = p[metric];
                const badShare = isFR ? ((b['>1d'] + (b.noReply || 0)) / b.total || 0) : (b['>1d'] / b.total || 0);
                return (
                  <tr key={p.key}>
                    <td style={tdL}>{p.label}</td>
                    {BK.map(k => <td key={k} style={td}>{(b as any)[k]}</td>)}
                    {isFR && <td style={{ ...td, color: (b.noReply || 0) > 0 ? '#b91c1c' : '#B4B2A9' }}>{b.noReply || 0}</td>}
                    <td style={{ ...td, fontWeight: 500 }}>{b.total}</td>
                    <td style={{ ...td, borderLeft: '0.5px solid #E8E7E3', color: isFR ? '#b91c1c' : '#128a3f' }}>{pct(isFR ? (b['>1d'] + (b.noReply || 0)) : b['>1d'], b.total)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: '#faf9f6' }}>
                <td style={{ ...tdL, fontWeight: 600 }}>TOTAL</td>
                {BK.map(k => <td key={k} style={{ ...td, fontWeight: 600 }}>{totals[k]}</td>)}
                {isFR && <td style={{ ...td, fontWeight: 600 }}>{totals.noReply}</td>}
                <td style={{ ...td, fontWeight: 600 }}>{totals.total}</td>
                <td style={{ ...td, fontWeight: 600, borderLeft: '0.5px solid #E8E7E3', color: isFR ? '#b91c1c' : '#128a3f' }}>
                  {pct(isFR ? (totals['>1d'] + totals.noReply) : totals['>1d'], totals.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 11, color: '#B4B2A9', marginTop: 12, maxWidth: 720 }}>
        {isFR
          ? 'Time to first reply = our first outbound message minus when the lead arrived. "No reply" means we never responded — the leads most likely being lost. This is the honest follow-up-speed measure the July CSV export could not provide.'
          : 'Follow-up depth = last activity minus lead received, matching Chisam\u2019s original proxy but from real message data. A higher 3+ day share means more threads stayed alive past the first exchange.'}
      </p>
    </div>
  );
}
