'use client';
import { useEffect, useState } from 'react';

type Buckets = { '0': number; '1': number; '2': number; '3': number; '4+': number; noReply?: number; total: number };
type Period = { key: string; label: string; firstReply: Buckets; depth: Buckets };
type Seg = 'All' | 'Wildlife' | 'Pest';

const pct = (n: number, d: number) => d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—';

export default function LsaLagReportPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'month' | 'week'>('month');
  const [seg, setSeg] = useState<Seg>('All');
  const [metric, setMetric] = useState<'firstReply' | 'depth'>('firstReply');
  const [location, setLocation] = useState('Southlake');

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
        ? ['Period', '0 days', '1 day', '2 days', '3 days', '4+ days', 'No reply', 'Total',
           '0d %', '1d %', '2d %', '3d %', '4+d %', 'No reply %']
        : ['Period', '0 days', '1 day', '2 days', '3 days', '4+ days', 'Total',
           '0d %', '1d %', '2d %', '3d %', '4+d %', '<1 day %', '3+ day %'];
      const aoa: any[][] = [header];
      const tot = { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0, noReply: 0, total: 0 } as any;
      for (const p of rows) {
        const b = p[m];
        for (const k of ['0', '1', '2', '3', '4+', 'total']) tot[k] += (b as any)[k] || 0;
        tot.noReply += b.noReply || 0;
        if (m === 'firstReply') {
          aoa.push([p.label, b['0'], b['1'], b['2'], b['3'], b['4+'], b.noReply || 0, b.total,
            +(b['0'] / b.total || 0), +(b['1'] / b.total || 0), +(b['2'] / b.total || 0),
            +(b['3'] / b.total || 0), +(b['4+'] / b.total || 0), +((b.noReply || 0) / b.total || 0)]);
        } else {
          const under1 = (b['0'] + b['1']) / b.total || 0;
          const over3 = (b['3'] + b['4+']) / b.total || 0;
          aoa.push([p.label, b['0'], b['1'], b['2'], b['3'], b['4+'], b.total,
            +(b['0'] / b.total || 0), +(b['1'] / b.total || 0), +(b['2'] / b.total || 0),
            +(b['3'] / b.total || 0), +(b['4+'] / b.total || 0), +under1, +over3]);
        }
      }
      // TOTAL row
      if (m === 'firstReply') {
        aoa.push(['TOTAL', tot['0'], tot['1'], tot['2'], tot['3'], tot['4+'], tot.noReply, tot.total,
          +(tot['0'] / tot.total || 0), +(tot['1'] / tot.total || 0), +(tot['2'] / tot.total || 0),
          +(tot['3'] / tot.total || 0), +(tot['4+'] / tot.total || 0), +(tot.noReply / tot.total || 0)]);
      } else {
        aoa.push(['TOTAL', tot['0'], tot['1'], tot['2'], tot['3'], tot['4+'], tot.total,
          +(tot['0'] / tot.total || 0), +(tot['1'] / tot.total || 0), +(tot['2'] / tot.total || 0),
          +(tot['3'] / tot.total || 0), +(tot['4+'] / tot.total || 0),
          +((tot['0'] + tot['1']) / tot.total || 0), +((tot['3'] + tot['4+']) / tot.total || 0)]);
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
      ['Buckets are whole-day differences: 0, 1, 2, 3, 4+.'],
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
    a['0'] += b['0']; a['1'] += b['1']; a['2'] += b['2']; a['3'] += b['3']; a['4+'] += b['4+'];
    a.noReply += b.noReply || 0; a.total += b.total;
    return a;
  }, { '0': 0, '1': 0, '2': 0, '3': 0, '4+': 0, noReply: 0, total: 0 } as any);

  return (
    <div style={{ padding: '0 24px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 500, color: '#2C2C2A', margin: 0 }}>LSA Follow-Up Lag Report</h1>
          <p style={{ fontSize: 12, color: '#888780', margin: '4px 0 0', maxWidth: 620 }}>
            Follow-up responsiveness on Google LSA message leads, from real message-level data. Two measures:
            how fast we send the first reply, and how long threads stay active.
          </p>
        </div>
        <button onClick={downloadExcel} disabled={!data}
          style={{ fontSize: 13, fontWeight: 500, padding: '8px 16px', borderRadius: 8, border: '0.5px solid #2C2C2A', background: '#2C2C2A', color: '#fff', cursor: data ? 'pointer' : 'default' }}>
          ↓ Download Excel
        </button>
      </div>

      {/* Location selector */}
      <div style={{ display: 'flex', gap: 4, marginTop: 16, background: '#f1efe8', borderRadius: 8, padding: 3, flexWrap: 'wrap', width: 'fit-content' }}>
        {(data?.locations || ['Southlake']).map((loc: string) => (
          <button key={loc} onClick={() => setLocation(loc)}
            style={{ fontSize: 12, padding: '6px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: location === loc ? '#fff' : 'transparent', color: location === loc ? '#2C2C2A' : '#888780', fontWeight: location === loc ? 600 : 400 }}>
            {loc}
          </button>
        ))}
      </div>

      {/* Metric selector — the two clearly-labeled measures */}
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button onClick={() => setMetric('firstReply')}
          style={{ flex: 1, textAlign: 'left', padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
            background: isFR ? '#eef4ff' : '#fff', border: `0.5px solid ${isFR ? '#0052cc' : '#E8E7E3'}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: isFR ? '#0052cc' : '#2C2C2A' }}>Time to First Reply</div>
          <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>How fast we engaged. Lower days = better.</div>
        </button>
        <button onClick={() => setMetric('depth')}
          style={{ flex: 1, textAlign: 'left', padding: '12px 16px', borderRadius: 10, cursor: 'pointer',
            background: !isFR ? '#fef9e6' : '#fff', border: `0.5px solid ${!isFR ? '#a16207' : '#E8E7E3'}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: !isFR ? '#a16207' : '#2C2C2A' }}>Follow-up Depth (Last-Activity Lag)</div>
          <div style={{ fontSize: 11, color: '#888780', marginTop: 2 }}>Chisam&apos;s original proxy, computed accurately. Higher days = sustained follow-up.</div>
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
              <th style={th}>0 days</th><th style={th}>1 day</th><th style={th}>2 days</th>
              <th style={th}>3 days</th><th style={th}>4+ days</th>
              {isFR && <th style={th}>No reply</th>}
              <th style={th}>Total</th>
              <th style={{ ...th, borderLeft: '0.5px solid #E8E7E3' }}>{isFR ? '4+ / No-reply %' : '3+ day %'}</th>
            </tr></thead>
            <tbody>
              {periods.map(p => {
                const b = p[metric];
                const badShare = isFR ? ((b['4+'] + (b.noReply || 0)) / b.total || 0) : ((b['3'] + b['4+']) / b.total || 0);
                return (
                  <tr key={p.key}>
                    <td style={tdL}>{p.label}</td>
                    <td style={td}>{b['0']}</td><td style={td}>{b['1']}</td><td style={td}>{b['2']}</td>
                    <td style={td}>{b['3']}</td><td style={td}>{b['4+']}</td>
                    {isFR && <td style={{ ...td, color: (b.noReply || 0) > 0 ? '#b91c1c' : '#B4B2A9' }}>{b.noReply || 0}</td>}
                    <td style={{ ...td, fontWeight: 500 }}>{b.total}</td>
                    <td style={{ ...td, borderLeft: '0.5px solid #E8E7E3', color: isFR ? '#b91c1c' : '#128a3f' }}>{pct(isFR ? (b['4+'] + (b.noReply || 0)) : (b['3'] + b['4+']), b.total)}</td>
                  </tr>
                );
              })}
              <tr style={{ background: '#faf9f6' }}>
                <td style={{ ...tdL, fontWeight: 600 }}>TOTAL</td>
                <td style={{ ...td, fontWeight: 600 }}>{totals['0']}</td><td style={{ ...td, fontWeight: 600 }}>{totals['1']}</td>
                <td style={{ ...td, fontWeight: 600 }}>{totals['2']}</td><td style={{ ...td, fontWeight: 600 }}>{totals['3']}</td>
                <td style={{ ...td, fontWeight: 600 }}>{totals['4+']}</td>
                {isFR && <td style={{ ...td, fontWeight: 600 }}>{totals.noReply}</td>}
                <td style={{ ...td, fontWeight: 600 }}>{totals.total}</td>
                <td style={{ ...td, fontWeight: 600, borderLeft: '0.5px solid #E8E7E3', color: isFR ? '#b91c1c' : '#128a3f' }}>
                  {pct(isFR ? (totals['4+'] + totals.noReply) : (totals['3'] + totals['4+']), totals.total)}
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
