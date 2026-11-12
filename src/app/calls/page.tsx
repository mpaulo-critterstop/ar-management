'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { canAccessModule } from '@/lib/access';
import { PageHeader, KpiStrip, DataTable, Toolbar, SearchBox, CustomerCell } from '@/components/cc/Layout';
import { Btn, StatusPill, SectionHeader, Card } from '@/components/cc/Primitives';
import { cc } from '@/components/cc/tokens';
import CCDatePicker from '@/components/cc/DatePicker';

const RANGES = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'This week', value: 'this_week' },
  { label: 'Last week', value: 'last_week' },
  { label: 'Last 7 days', value: 'last_7' },
  { label: 'Last 30 days', value: 'last_30' },
  { label: 'This month', value: 'current_month' },
  { label: 'Last month', value: 'last_month' },
  { label: 'Custom', value: 'custom' },
];

function fmtDuration(secs: number) {
  if (!secs) return '—';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function CallsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [range, setRange] = useState('today');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [agentSearch, setAgentSearch] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
    if (status === 'authenticated' && !canAccessModule(session?.user as any, 'dialpad')) router.replace('/');
  }, [status, router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ range });
    if (range === 'custom' && customStart && customEnd) { params.set('start', customStart); params.set('end', customEnd); }
    const res = await fetch(`/api/dialpad/calls?${params}`).catch(() => null);
    if (res?.ok) setData(await res.json());
    setLoading(false);
  }, [range, customStart, customEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  if (status === 'loading') return null;

  const total = data?.total || 0;
  const answered = data?.answered || 0;
  const agentMissed = data?.agent_missed || 0;
  // Answer rate = answered / (answered + missed) — the true attempt basis (excludes abandoned/voicemail/missed-opportunity).
  const answerDenom = answered + agentMissed;
  const answerRate = answerDenom ? Math.round((answered / answerDenom) * 100) : 0;
  const rangeLabel = RANGES.find(r => r.value === range)?.label || '';

  const kpiItems = [
    { icon: '🎯', label: 'Team answer rate', value: loading ? '…' : `${answerRate}%`, tone: (answerRate >= 90 ? 'green' : answerRate >= 75 ? 'amber' : 'red') as 'green' | 'amber' | 'red', delta: `${answered.toLocaleString()} of ${answerDenom.toLocaleString()} attempts`, deltaTone: (answerRate >= 90 ? 'green' : 'amber') as 'green' | 'amber' },
    { icon: '📞', label: 'Total calls', value: loading ? '…' : total.toLocaleString(), tone: 'blue' as const, delta: rangeLabel },
    { icon: '✅', label: 'Answered', value: loading ? '…' : answered.toLocaleString(), tone: 'green' as const, delta: `${agentMissed.toLocaleString()} missed`, deltaTone: 'green' as const },
    { icon: '📵', label: 'Agent missed', value: loading ? '…' : (data?.agent_missed || 0).toLocaleString(), tone: 'amber' as const, delta: `${(data?.ring_no_answer || 0).toLocaleString()} ring no answer` },
    { icon: '⚠️', label: 'Missed opportunity', value: loading ? '…' : (data?.missed_opportunity || 0).toLocaleString(), tone: 'red' as const, delta: 'no agent reached' },
    { icon: '🆕', label: 'First-time callers', value: loading ? '…' : (data?.first_time || 0).toLocaleString(), tone: 'violet' as const, delta: 'new numbers' },
  ];

  const dailyEntries: any[] = Object.entries(data?.daily_volume || {});
  const maxVol = Math.max(1, ...dailyEntries.map(([, v]: any) => (v.answered || 0) + (v.missed || 0)));

  const agents: any[] = (data?.agent_stats || [])
    .filter((a: any) => !agentSearch.trim() || String(a.name || '').toLowerCase().includes(agentSearch.trim().toLowerCase()))
    .slice().sort((a: any, b: any) => (b.answered || 0) - (a.answered || 0));

  const agentCols: any[] = [
    // Total = answered + missed (true inbound attempts). Excludes abandoned/voicemail so the answer rate is accurate.
    { key: 'agent', label: 'Agent', render: (a: any) => <CustomerCell name={a.name} /> },
    { key: 'total', label: 'Total', align: 'right', render: (a: any) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{(a.answered || 0) + (a.missed || 0)}</span> },
    { key: 'answered', label: 'Answered', align: 'right', render: (a: any) => <span style={{ color: cc.green, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{a.answered}</span> },
    { key: 'missed', label: 'Missed', align: 'right', render: (a: any) => <span style={{ color: (a.missed ? cc.amber : cc.muted), fontVariantNumeric: 'tabular-nums' }}>{a.missed}</span> },
    { key: 'ftc', label: 'First-time', align: 'right', render: (a: any) => <span style={{ fontVariantNumeric: 'tabular-nums', color: cc.muted }}>{a.first_time ?? '—'}</span> },
    { key: 'ar', label: 'Answer rate', align: 'right', render: (a: any) => { const denom = (a.answered || 0) + (a.missed || 0); const ar = denom ? Math.round((a.answered / denom) * 100) : 0; return <StatusPill tone={ar >= 90 ? 'green' : ar >= 75 ? 'amber' : 'red'}>{ar}%</StatusPill>; } },
    { key: 'dur', label: 'Avg duration', align: 'right', render: (a: any) => <span style={{ color: cc.muted, fontVariantNumeric: 'tabular-nums' }}>{fmtDuration(a.answered > 0 ? Math.round(a.totalDuration / a.answered) : 0)}</span> },
  ];

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '30px 34px 70px' }}>
      <PageHeader icon="📞" title="Dialpad Call Analytics" subtitle="Call volume, answer rate, and per-agent performance across every office"
        actions={<Btn variant="secondary" onClick={() => loadData()}>↻ Refresh</Btn>} />

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 22 }}>
        {RANGES.map(r => {
          const on = range === r.value;
          return (
            <button key={r.value} onClick={() => { setRange(r.value); setShowCustom(r.value === 'custom'); }}
              style={{ fontSize: 12.5, fontWeight: on ? 600 : 500, padding: '7px 14px', borderRadius: 9, cursor: 'pointer',
                border: `1px solid ${on ? cc.blue : cc.line}`, background: on ? cc.bluebg : cc.panel, color: on ? cc.blue : cc.muted }}>
              {r.label}
            </button>
          );
        })}
      </div>
      {showCustom && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 22 }}>
          <CCDatePicker value={customStart} onChange={setCustomStart} placeholder="From" />
          <span style={{ color: cc.muted }}>to</span>
          <CCDatePicker value={customEnd} onChange={setCustomEnd} placeholder="To" />
        </div>
      )}

      <KpiStrip items={kpiItems} />

      {dailyEntries.length > 0 && <>
        <SectionHeader note="answered vs missed by day">Call volume</SectionHeader>
        <Card style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, paddingTop: 8 }}>
            {dailyEntries.map(([day, vol]: any) => {
              const answeredN = vol.answered || 0, missedN = vol.missed || 0, totalN = answeredN + missedN;
              const totalH = (totalN / maxVol) * 130;
              const answeredH = totalN > 0 ? (answeredN / totalN) * totalH : 0;
              const missedH = totalH - answeredH;
              return (
                <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}
                  title={`${day}: ${answeredN} answered, ${missedN} missed`}>
                  <div style={{ width: '72%', maxWidth: 30, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                    <div style={{ height: missedH, background: cc.red, borderRadius: missedH > 0 ? '4px 4px 0 0' : 0 }} />
                    <div style={{ height: answeredH, background: cc.blue, borderRadius: missedH > 0 ? 0 : '4px 4px 0 0' }} />
                  </div>
                  <div style={{ fontSize: 10, color: cc.faint, whiteSpace: 'nowrap' }}>{String(day).slice(5)}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11.5, color: cc.muted }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 11, height: 11, borderRadius: 3, background: cc.blue, display: 'inline-block' }} /> Answered</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 11, height: 11, borderRadius: 3, background: cc.red, display: 'inline-block' }} /> Missed</span>
          </div>
        </Card>
      </>}

      <SectionHeader note={`${agents.length} agents · ${rangeLabel.toLowerCase()}`}>Agent performance</SectionHeader>
      <Toolbar>
        <div style={{ fontSize: 13, fontWeight: 600, color: cc.ink2 }}>Ranked by answered calls</div>
        <SearchBox value={agentSearch} onChange={setAgentSearch} placeholder="Search agent…" />
      </Toolbar>
      <DataTable cols={agentCols} rows={agents} rowKey={(a: any) => a.name} empty={loading ? 'Loading…' : 'No data for this period.'} />

      {/* Tracking number breakdowns */}
      <SectionHeader note="by phone line">Caller breakdown</SectionHeader>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13 }}>
        <Card style={{ padding: 18 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: cc.ink }}>Calls per tracking number</div>
          <div style={{ fontSize: 11.5, color: cc.muted, marginBottom: 12 }}>Total volume by line</div>
          {(() => {
            const entries = Object.entries(data?.tracking_numbers || {}).sort(([, a]: any, [, b]: any) => (b as number) - (a as number));
            const max = entries.length ? (entries[0][1] as number) : 1;
            if (loading) return <div style={{ textAlign: 'center', color: cc.faint, padding: 28, fontSize: 13 }}>Loading…</div>;
            if (!entries.length) return <div style={{ textAlign: 'center', color: cc.faint, padding: 28, fontSize: 13 }}>No data</div>;
            return <div style={{ overflowY: 'auto', maxHeight: 340, paddingRight: 10 }}>
              {entries.map(([num, count]: any) => (
                <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${cc.line}` }}>
                  <div style={{ fontSize: 12.5, color: cc.ink2, width: 134, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{num}</div>
                  <div style={{ flex: 1, height: 7, background: cc.panel2, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: cc.blue, borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: cc.ink, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{count}</div>
                </div>
              ))}
            </div>;
          })()}
        </Card>
        <Card style={{ padding: 18 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: cc.ink }}>First-time callers by tracking number</div>
          <div style={{ fontSize: 11.5, color: cc.muted, marginBottom: 12 }}>New leads per line</div>
          {(() => {
            const entries = Object.entries(data?.first_time_by_tracking || {})
              .sort(([, a]: any, [, b]: any) => b.first_time - a.first_time)
              .filter(([, v]: any) => v.first_time > 0);
            const max = entries.length ? (entries[0][1] as any).first_time : 1;
            if (loading) return <div style={{ textAlign: 'center', color: cc.faint, padding: 28, fontSize: 13 }}>Loading…</div>;
            if (!entries.length) return <div style={{ textAlign: 'center', color: cc.faint, padding: 28, fontSize: 13 }}>No data</div>;
            return <div style={{ overflowY: 'auto', maxHeight: 340, paddingRight: 10 }}>
              {entries.map(([num, v]: any) => (
                <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${cc.line}` }}>
                  <div style={{ fontSize: 12.5, color: cc.ink2, width: 134, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{num}</div>
                  <div style={{ flex: 1, height: 7, background: cc.panel2, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${(v.first_time / max) * 100}%`, height: '100%', background: cc.green, borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: cc.ink, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.first_time}</div>
                </div>
              ))}
            </div>;
          })()}
        </Card>
      </div>
    </div>
  );
}
